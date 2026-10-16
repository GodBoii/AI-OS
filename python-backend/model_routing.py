"""Primary-agent model routing for chat conversations."""

from dataclasses import dataclass
from pathlib import PurePath
from typing import Any, Iterable, Mapping, Optional


DEFAULT_MODEL_ID = "xiaomi/mimo-v2.6-pro"
ULTRA_MODEL_ID = DEFAULT_MODEL_ID
VIDEO_MODEL_ID = DEFAULT_MODEL_ID
# Compatibility names for callers that predate the shared multimodal model.
DEEPSEEK_MODEL_ID = DEFAULT_MODEL_ID
GLM_VIDEO_MODEL_ID = DEFAULT_MODEL_ID

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

    Every mode accepts the same media through the shared multimodal model.
    Keep the Ultra preference for existing conversations, but ignore legacy
    video routes: attaching media no longer locks the conversation's mode.
    """
    normalized_mode = normalize_thinking_mode(thinking_mode)
    normalized_route = normalize_sticky_route(sticky_route)
    has_video = attachments_include_video(files)

    route = ULTRA_ROUTE if normalized_mode == ULTRA_THINKING_MODE or normalized_route == ULTRA_ROUTE else None
    return PrimaryModelSelection(DEFAULT_MODEL_ID, route, has_video, normalized_mode)
