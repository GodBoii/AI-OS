import base64
import binascii
import json
import logging
import os
import time
import traceback
import uuid
from typing import Any, Dict, List, Optional, Sequence, Tuple

import requests

from agno.media import Image, Video
from agno.tools import Toolkit
from agno.tools.function import ToolResult

from openrouter_image_client import (
    ImageGenerationError,
    TEXT_IMAGE_MODEL,
    generate_openrouter_image,
    validate_image_bytes,
)

from sandbox_persistence import get_persistence_service
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

OPENROUTER_VIDEO_URL = "https://openrouter.ai/api/v1/videos"
VIDEO_MODEL_ID = "google/veo-3.1-lite"


class MediaTools(Toolkit):
    """Generate images and videos, persist them, and notify the frontend by URL."""

    def __init__(self, custom_tool_config: Dict[str, Any]):
        super().__init__(
            name="media_tools",
            tools=[self.create_image, self.generate_image, self.generate_video],
        )

        self.socketio = custom_tool_config.get("socketio")
        self.sid = custom_tool_config.get("sid")
        self.message_id = custom_tool_config.get("message_id")
        self.conversation_id = custom_tool_config.get("conversation_id")
        self.user_id = custom_tool_config.get("user_id")
        self.files = custom_tool_config.get("files") or []
        self.openrouter_api_key = os.getenv("OPENROUTER_API_KEY")

        if not self.openrouter_api_key:
            logger.error("MediaTools: OPENROUTER_API_KEY is not configured")

    def create_image(
        self,
        text: str,
        image: Optional[str] = None,
        images: Optional[Sequence[Image]] = None,
    ) -> ToolResult:
        """Create or edit an image and return it to both the user and the model.

        Args:
            text: Description of the image to create, or changes to a reference image.
            image: Optional HTTP(S) or base64 image data URL. When omitted, use the
                current turn's attached image. Attach at most one reference image.
        """
        try:
            reference = self._create_image_reference(image, images, {"turn_context": {"files": self.files}})
            generated = generate_openrouter_image(self.openrouter_api_key, text, reference)
            artifact_id, signed_url, file_name = self._persist_generated_media(
                media_bytes=generated.content,
                mime_type=generated.mime_type,
                media_kind="image",
                prompt=text,
                source_urls=[reference] if reference and not reference.startswith("data:") else [],
                provider_response={"model": generated.model},
            )
            metadata = {
                "kind": "generated_image_tool_output",
                "action": "create_image",
                "preview_type": "image",
                "artifact_id": artifact_id,
                "output_id": artifact_id,
                "media_url": signed_url,
                "media_url_expires_at": int(time.time()) + 3600,
                "mime_type": generated.mime_type,
                "filename": file_name,
                "model": generated.model,
                "conversation_id": self.conversation_id,
                "title": "Generated image",
            }
            result = ToolResult(
                content=json.dumps({
                    "ok": True,
                    "message": f"Image generated.\n\n```image\n{artifact_id}\n```",
                    "metadata": metadata,
                }),
                images=[Image(content=generated.content, mime_type=generated.mime_type, name=file_name)],
            )
        except ImageGenerationError as exc:
            return ToolResult(content=json.dumps({"ok": False, "error": str(exc)}))
        except Exception:
            logger.exception("MediaTools.create_image failed during attachment loading or persistence")
            return ToolResult(content=json.dumps({
                "ok": False, "error": "Could not load the reference image or save the generated image. Try again."
            }))

        # A disconnected frontend must not discard an image already saved for the model.
        try:
            self._emit_media_generated(
                artifact_id=artifact_id,
                media_type="image",
                media_url=signed_url,
                mime_type=generated.mime_type,
                file_name=file_name,
            )
        except Exception:
            logger.exception("MediaTools: image saved, but live notification failed")
        return result

    def _create_image_reference(
        self, image: Optional[str], images: Optional[Sequence[Image]], session_state: Optional[Dict[str, Any]]
    ) -> Optional[str]:
        if image is not None:
            return image
        if images:
            if len(images) != 1:
                raise ImageGenerationError("Attach one reference image or select one with the image URL argument.")
            attachment = images[0]
            content = getattr(attachment, "content", None)
            if isinstance(content, (bytes, bytearray)):
                mime_type = validate_image_bytes(bytes(content))
                return f"data:{mime_type};base64,{base64.b64encode(content).decode('ascii')}"
            reference = self._image_to_data_url(attachment)
            if not reference:
                raise ImageGenerationError("Could not read the attached reference image.")
            return reference
        files = ((session_state or {}).get("turn_context") or {}).get("files") or []
        attachments = [f for f in files if isinstance(f, dict) and str(f.get("type", "")).startswith("image/")]
        if len(attachments) > 1:
            raise ImageGenerationError("Attach one reference image or select one with the image URL argument.")
        if attachments:
            path = attachments[0].get("path")
            reference = self._create_signed_media_url(path, expires_in=7200) if path else None
            if not reference:
                raise ImageGenerationError("Could not access the attached reference image.")
            return reference
        return None

    def generate_image(
        self,
        prompt: str,
        images: Optional[Sequence[Image]] = None,
        videos: Optional[Sequence[Video]] = None,
        session_state: Optional[Dict[str, Any]] = None,
    ) -> ToolResult:
        """Compatibility alias for create_image. Use create_image for new requests."""
        try:
            reference = self._create_image_reference(None, images, session_state)
        except ImageGenerationError as exc:
            return ToolResult(content=json.dumps({"ok": False, "error": str(exc)}))
        return self.create_image(text=prompt, image=reference)

    def generate_video(
        self,
        prompt: str,
        images: Optional[Sequence[Image]] = None,
        videos: Optional[Sequence[Video]] = None,
        session_state: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Generate a video from a prompt and optional attached reference media."""
        if not self.openrouter_api_key:
            return "Video generation is unavailable because OPENROUTER_API_KEY is not configured."

        try:
            image_urls, video_urls = self._collect_attachment_urls(
                session_state=session_state,
                images=images,
                videos=videos,
            )
            payload: Dict[str, Any] = {
                "model": VIDEO_MODEL_ID,
                "prompt": self._build_prompt_with_reference_urls(
                    prompt=prompt,
                    image_urls=[],
                    video_urls=video_urls,
                ),
                "duration": 4,
                "resolution": "720p",
                "aspect_ratio": "16:9",
            }

            if image_urls:
                payload["input_references"] = [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url},
                    }
                    for image_url in image_urls[:4]
                ]

            submit_response = requests.post(
                OPENROUTER_VIDEO_URL,
                headers=self._openrouter_headers(),
                json=payload,
                timeout=90,
            )
            submit_response.raise_for_status()
            job = submit_response.json()

            polling_url = str(job.get("polling_url") or "").strip()
            if polling_url.startswith("/"):
                polling_url = f"https://openrouter.ai{polling_url}"
            if not polling_url:
                raise RuntimeError("OpenRouter did not return a polling URL for the video job.")

            status_payload = self._poll_video_job(polling_url)
            unsigned_urls = status_payload.get("unsigned_urls") or []
            if not unsigned_urls:
                raise RuntimeError("Video generation completed without any downloadable video URLs.")

            video_response = requests.get(unsigned_urls[0], timeout=300)
            video_response.raise_for_status()
            video_bytes = video_response.content

            artifact_id, signed_url, file_name = self._persist_generated_media(
                media_bytes=video_bytes,
                mime_type="video/mp4",
                media_kind="video",
                prompt=prompt,
                source_urls=image_urls + video_urls,
                provider_response=status_payload,
            )

            self._emit_media_generated(
                artifact_id=artifact_id,
                media_type="video",
                media_url=signed_url,
                mime_type="video/mp4",
                file_name=file_name,
            )
            return f"Video generated. The user can view it in the frontend.\n\n```video\n{artifact_id}\n```"
        except Exception as exc:
            logger.error("MediaTools.generate_video failed: %s\n%s", exc, traceback.format_exc())
            return f"Video generation failed: {exc}"

    def _openrouter_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.openrouter_api_key}",
            "Content-Type": "application/json",
        }

    def _build_prompt_with_reference_urls(self, prompt: str, image_urls: List[str], video_urls: List[str]) -> str:
        lines = [prompt.strip()]
        if image_urls:
            lines.append("")
            lines.append("Reference image URLs:")
            lines.extend(f"- {url}" for url in image_urls)
        if video_urls:
            lines.append("")
            lines.append("Reference video URLs:")
            lines.extend(f"- {url}" for url in video_urls)
        return "\n".join(line for line in lines if line is not None).strip()

    def _collect_attachment_urls(
        self,
        *,
        session_state: Optional[Dict[str, Any]],
        images: Optional[Sequence[Image]] = None,
        videos: Optional[Sequence[Video]] = None,
    ) -> Tuple[List[str], List[str]]:
        turn_context = (session_state or {}).get("turn_context") or {}
        files = turn_context.get("files") or []
        image_urls: List[str] = []
        video_urls: List[str] = []

        for file_info in files:
            if not isinstance(file_info, dict):
                continue
            storage_path = str(file_info.get("path") or "").strip()
            mime_type = str(file_info.get("type") or "").strip().lower()
            if not storage_path:
                continue
            signed_url = self._create_signed_media_url(storage_path, expires_in=7200)
            if not signed_url:
                continue
            if mime_type.startswith("image/"):
                image_urls.append(signed_url)
            elif mime_type.startswith("video/"):
                video_urls.append(signed_url)

        if not image_urls and images:
            image_urls = [url for url in (self._image_to_data_url(image) for image in images[:4]) if url]
        if not video_urls and videos:
            video_urls = [name for name in (getattr(video, "name", None) for video in videos) if name]

        return image_urls, video_urls

    def _create_signed_media_url(self, storage_path: str, expires_in: int = 3600) -> Optional[str]:
        try:
            response = supabase_client.storage.from_("media-uploads").create_signed_url(storage_path, expires_in)
            if isinstance(response, dict):
                return response.get("signedURL") or response.get("signed_url")
        except Exception as exc:
            logger.warning("MediaTools: failed to create signed URL for %s: %s", storage_path, exc)
        return None

    def _image_to_data_url(self, image: Image) -> Optional[str]:
        content = getattr(image, "content", None)
        if isinstance(content, str):
            stripped = content.strip()
            if stripped.startswith("data:"):
                return stripped
            try:
                base64.b64decode(stripped, validate=True)
                return f"data:image/png;base64,{stripped}"
            except (ValueError, binascii.Error):
                return None

        if isinstance(content, (bytes, bytearray)):
            return f"data:image/png;base64,{base64.b64encode(bytes(content)).decode('utf-8')}"

        url = getattr(image, "url", None)
        if isinstance(url, str) and url.strip():
            return url.strip()

        return None

    def _persist_generated_media(
        self,
        *,
        media_bytes: bytes,
        mime_type: str,
        media_kind: str,
        prompt: str,
        source_urls: List[str],
        provider_response: Dict[str, Any],
    ) -> Tuple[str, str, str]:
        artifact_id = str(uuid.uuid4())
        extension = self._extension_for_mime_type(mime_type=mime_type, media_kind=media_kind)
        file_name = f"generated-{media_kind}-{artifact_id}.{extension}"
        user_segment = self.user_id or "unknown-user"
        conversation_segment = self.conversation_id or "unknown-conversation"
        storage_path = f"{user_segment}/{conversation_segment}/generated/{file_name}"

        supabase_client.storage.from_("media-uploads").upload(
            storage_path,
            media_bytes,
            file_options={"content-type": mime_type},
        )

        signed_url = self._create_signed_media_url(storage_path, expires_in=3600)
        if not signed_url:
            raise RuntimeError("Generated media was uploaded but no signed URL could be created.")

        if self.conversation_id and self.user_id:
            persistence_service = get_persistence_service()
            persistence_service.register_content(
                session_id=self.conversation_id,
                user_id=self.user_id,
                content_type="upload",
                reference_id=artifact_id,
                message_id=self.message_id,
                metadata={
                    "filename": file_name,
                    "mime_type": mime_type,
                    "size": len(media_bytes),
                    "path": storage_path,
                    "isMedia": True,
                    "is_text": False,
                    "is_generated": True,
                    "artifact_type": media_kind,
                    "provider": "openrouter",
                    "model": provider_response.get("model") or (TEXT_IMAGE_MODEL if media_kind == "image" else VIDEO_MODEL_ID),
                    "prompt": prompt,
                    "source_urls": source_urls,
                    "provider_response": {
                        "id": provider_response.get("id"),
                        "status": provider_response.get("status"),
                        "generation_id": provider_response.get("generation_id"),
                        "model": provider_response.get("model"),
                    },
                },
            )

        return artifact_id, signed_url, file_name

    def _emit_media_generated(
        self,
        *,
        artifact_id: str,
        media_type: str,
        media_url: str,
        mime_type: str,
        file_name: str,
    ) -> None:
        if not self.socketio or not self.conversation_id:
            return
        payload = {
            "id": self.message_id,
            "artifactId": artifact_id,
            "conversationId": self.conversation_id,
            "mediaType": media_type,
            "mediaUrl": media_url,
            "mimeType": mime_type,
            "fileName": file_name,
            "agent_name": "MediaTools",
        }
        self.socketio.emit("media_generated", payload, room=f"conv:{self.conversation_id}")

    def _poll_video_job(self, polling_url: str) -> Dict[str, Any]:
        started_at = time.time()
        while True:
            response = requests.get(
                polling_url,
                headers={"Authorization": f"Bearer {self.openrouter_api_key}"},
                timeout=60,
            )
            response.raise_for_status()
            payload = response.json()
            status = str(payload.get("status") or "").strip().lower()
            if status == "completed":
                return payload
            if status in {"failed", "cancelled", "expired"}:
                raise RuntimeError(payload.get("error") or f"Video generation ended with status '{status}'.")
            if time.time() - started_at > 900:
                raise TimeoutError("Video generation timed out after 15 minutes.")
            time.sleep(5)

    def _extension_for_mime_type(self, *, mime_type: str, media_kind: str) -> str:
        if mime_type == "image/png":
            return "png"
        if mime_type == "image/jpeg":
            return "jpg"
        if mime_type == "image/webp":
            return "webp"
        if mime_type == "video/mp4":
            return "mp4"
        return "png" if media_kind == "image" else "mp4"
