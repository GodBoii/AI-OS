"""Primary-agent model routing for chat conversations."""

from dataclasses import dataclass
from pathlib import PurePath
from typing import Any, Iterable, Mapping, Optional


DEEPSEEK_MODEL_ID = "deepseek/deepseek-v4.1-flash"
GLM_VIDEO_MODEL_ID = "z-ai/glm-5.3-flash"
DEFAULT_MODEL_ID = DEEPSEEK_MODEL_ID
ULTRA_MODEL_ID = DEEPSEEK_MODEL_ID
VIDEO_MODEL_ID = GLM_VIDEO_MODEL_ID

STANDARD_THINKING_MODE = "standard"
ULTRA_THINKING_MODE = "ultra"

VIDEO_ROUTE = "video"
ULTRA_ROUTE = "ultra"
_STICKY_ROUTES = {VIDEO_ROUTE, ULTRA_ROUTE}
_VIDEO_EXTENSIONS = {"mp4", "webm", "avi", "mov", "mkv"}


class ModelRoutingError(ValueError):
    """Raised when a conversation's model route cannot accept the request."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class PrimaryModelSelection:
    model_id: str
    sticky_route: Optional[str]
    has_video: bool
    thinking_mode: str


def normalize_thinking_mode(raw_value: Any) -> str:
    value = str(raw_value or "").strip().lower().replace("-", "_").replace(" ", "_")
    if value in {"ultra", "ultra_think", "ultrathink"}:
        return ULTRA_THINKING_MODE
    return STANDARD_THINKING_MODE


def normalize_sticky_route(raw_value: Any) -> Optional[str]:
    value = str(raw_value or "").strip().lower()
    return value if value in _STICKY_ROUTES else None


def is_video_attachment(file_data: Mapping[str, Any]) -> bool:
    mime_type = str(file_data.get("type") or file_data.get("mime_type") or "").strip().lower()
    if mime_type.startswith("video/"):
        return True

    name = str(file_data.get("name") or file_data.get("filename") or "").strip()
    suffix = PurePath(name).suffix.lower().lstrip(".")
    return suffix in _VIDEO_EXTENSIONS


def attachments_include_video(files: Iterable[Mapping[str, Any]]) -> bool:
    return any(is_video_attachment(file_data) for file_data in files or [])


def resolve_primary_model(
    *,
    thinking_mode: Any,
    files: Iterable[Mapping[str, Any]],
    sticky_route: Any = None,
) -> PrimaryModelSelection:
    """
    Select the active top-level agent model.

    Standard conversations may be promoted by their first special input.
    The route remains sticky for later turns. Standard and Ultra use DeepSeek,
    while video conversations use GLM.
    """
    normalized_mode = normalize_thinking_mode(thinking_mode)
    normalized_route = normalize_sticky_route(sticky_route)
    has_video = attachments_include_video(files)

    if normalized_mode == ULTRA_THINKING_MODE and has_video:
        raise ModelRoutingError(
            "Video attachments are unavailable in Ultra Think mode.",
            code="ultra_video_not_supported",
        )

    if normalized_route == ULTRA_ROUTE and has_video:
        raise ModelRoutingError(
            "This Ultra Think conversation cannot accept video attachments.",
            code="conversation_model_locked_to_ultra",
        )

    if normalized_route == VIDEO_ROUTE:
        if normalized_mode == ULTRA_THINKING_MODE:
            raise ModelRoutingError(
                "This conversation is using video input mode. Start a new conversation to use Ultra Think.",
                code="conversation_model_locked_to_video",
            )
        return PrimaryModelSelection(VIDEO_MODEL_ID, VIDEO_ROUTE, has_video, normalized_mode)

    if normalized_route == ULTRA_ROUTE:
        return PrimaryModelSelection(ULTRA_MODEL_ID, ULTRA_ROUTE, has_video, normalized_mode)

    if normalized_mode == ULTRA_THINKING_MODE:
        return PrimaryModelSelection(ULTRA_MODEL_ID, ULTRA_ROUTE, has_video, normalized_mode)
    if has_video:
        return PrimaryModelSelection(VIDEO_MODEL_ID, VIDEO_ROUTE, has_video, normalized_mode)
    return PrimaryModelSelection(DEFAULT_MODEL_ID, None, has_video, normalized_mode)
