import base64
import mimetypes
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Type, Union

from openai.types.chat import ChatCompletion, ChatCompletionChunk
from pydantic import BaseModel

from agno.models.openrouter import OpenRouter
from agno.models.message import Message
from agno.models.response import ModelResponse


def _read_reasoning_config() -> Optional[Dict[str, Any]]:
    enabled = os.getenv("OPENROUTER_REASONING_ENABLED", "true").strip().lower()
    if enabled in {"0", "false", "no", "off"}:
        return None

    config: Dict[str, Any] = {"effort": "xhigh", "exclude": False}

    effort = os.getenv("OPENROUTER_REASONING_EFFORT")
    if effort:
        config["effort"] = effort.strip()

    max_tokens = os.getenv("OPENROUTER_REASONING_MAX_TOKENS")
    if max_tokens:
        try:
            config.pop("effort", None)
            config["max_tokens"] = int(max_tokens)
        except ValueError:
            pass

    return config


def _extra_from(obj: Any) -> Dict[str, Any]:
    extra = getattr(obj, "model_extra", None)
    return extra if isinstance(extra, dict) else {}


def _reasoning_details_from(obj: Any) -> Optional[List[Any]]:
    details = getattr(obj, "reasoning_details", None)
    if details:
        return details
    extra = _extra_from(obj)
    details = extra.get("reasoning_details")
    return details if details else None


def _field(detail: Any, name: str) -> Any:
    if isinstance(detail, dict):
        return detail.get(name)
    return getattr(detail, name, None)


def _reasoning_details_to_text(details: Optional[List[Any]]) -> Optional[str]:
    if not details:
        return None

    parts: List[str] = []
    for detail in details:
        text = _field(detail, "text")
        summary = _field(detail, "summary")
        data = text if text is not None else summary
        if isinstance(data, list):
            data = "\n".join(str(item) for item in data if item is not None)
        if data is not None:
            value = str(data)
            if value.strip():
                parts.append(value)

    return "".join(parts) if parts else None


@dataclass
class OpenRouterReasoning(OpenRouter):
    """
    OpenRouter adapter that normalizes OpenRouter-native reasoning payloads into
    Agno's `reasoning_content` field so the existing Socket.IO/UI pipeline works.
    """

    reasoning: Optional[Dict[str, Any]] = None

    def _format_message(self, message: Message, compress_tool_results: bool = False) -> Dict[str, Any]:
        videos = list(message.videos or [])
        message_without_videos = message.model_copy(update={"videos": None}) if videos else message
        try:
            message_dict = super()._format_message(
                message_without_videos,
                compress_tool_results=compress_tool_results,
            )
        except TypeError as exc:
            if "compress_tool_results" not in str(exc):
                raise
            message_dict = super()._format_message(message_without_videos)

        if videos:
            content = message_dict.get("content")
            if isinstance(content, str):
                content = [{"type": "text", "text": content}]
            elif not isinstance(content, list):
                content = []

            for video in videos:
                video_url = _openrouter_video_url(video)
                if video_url:
                    content.append({"type": "video_url", "video_url": {"url": video_url}})
            message_dict["content"] = content

        return message_dict

    def get_request_params(
        self,
        response_format: Optional[Union[Dict, Type[BaseModel]]] = None,
        tools: Optional[List[Dict[str, Any]]] = None,
        tool_choice: Optional[Union[str, Dict[str, Any]]] = None,
        run_response: Optional[Any] = None,
    ) -> Dict[str, Any]:
        try:
            request_params = super().get_request_params(
                response_format=response_format,
                tools=tools,
                tool_choice=tool_choice,
                run_response=run_response,
            )
        except TypeError as exc:
            if "run_response" not in str(exc):
                raise
            request_params = super().get_request_params(
                response_format=response_format,
                tools=tools,
                tool_choice=tool_choice,
            )

        reasoning_config = self.reasoning if self.reasoning is not None else _read_reasoning_config()
        if reasoning_config is not None:
            extra_body = request_params.get("extra_body") or {}
            if not isinstance(extra_body, dict):
                extra_body = {}
            extra_body.setdefault("reasoning", reasoning_config)
            request_params["extra_body"] = extra_body

        return request_params

    def _parse_provider_response(
        self,
        response: ChatCompletion,
        response_format: Optional[Union[Dict, Type[BaseModel]]] = None,
    ) -> ModelResponse:
        model_response = super()._parse_provider_response(response, response_format)

        if response.choices:
            response_message = response.choices[0].message
            details = _reasoning_details_from(response_message)
            text = _reasoning_details_to_text(details)
            if text and not model_response.reasoning_content:
                model_response.reasoning_content = text

        return model_response

    def _parse_provider_response_delta(self, response_delta: ChatCompletionChunk) -> ModelResponse:
        model_response = super()._parse_provider_response_delta(response_delta)

        if response_delta.choices:
            choice_delta = response_delta.choices[0].delta
            details = _reasoning_details_from(choice_delta)
            text = _reasoning_details_to_text(details)
            if text:
                model_response.reasoning_content = text
                if model_response.content is None:
                    model_response.content = ""

        return model_response


def get_openrouter_model(model: str = "xiaomi/mimo-v2.5", **kwargs: Any) -> OpenRouterReasoning:
    return OpenRouterReasoning(id=model, **kwargs)


def _openrouter_video_url(video: Any) -> Optional[str]:
    url = getattr(video, "url", None)
    if url:
        return str(url)

    content = getattr(video, "content", None)
    filepath = getattr(video, "filepath", None)
    if content is None and filepath:
        content = Path(filepath).read_bytes()
    if not content:
        return None

    mime_type = _video_mime_type(video)
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def _video_mime_type(video: Any) -> str:
    mime_type = getattr(video, "mime_type", None)
    if mime_type:
        return str(mime_type)

    format_hint = getattr(video, "format", None)
    name_hint = getattr(video, "name", None)
    filepath = getattr(video, "filepath", None)
    if format_hint:
        suffix = f".{str(format_hint).lstrip('.')}"
    else:
        candidate = str(name_hint or filepath or "video.mp4")
        suffix = candidate if candidate.startswith(".") else Path(candidate).suffix
    guessed_type = mimetypes.guess_type(f"video{suffix}")[0]
    if guessed_type == "video/quicktime":
        return "video/mov"
    return guessed_type or "video/mp4"
