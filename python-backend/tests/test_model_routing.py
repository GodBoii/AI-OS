import sys
from pathlib import Path

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from model_routing import (  # noqa: E402
    DEFAULT_MODEL_ID,
    ULTRA_MODEL_ID,
    ULTRA_ROUTE,
    VIDEO_MODEL_ID,
    VIDEO_ROUTE,
    ModelRoutingError,
    attachments_include_video,
    normalize_thinking_mode,
    resolve_primary_model,
)


@pytest.mark.parametrize(
    ("file_data", "expected"),
    [
        ({"name": "clip.bin", "type": "video/mp4"}, True),
        ({"name": "clip.MOV", "type": "application/octet-stream"}, True),
        ({"name": "notes.mp4.txt", "type": "text/plain"}, False),
        ({"name": "photo.png", "type": "image/png"}, False),
    ],
)
def test_video_attachment_detection(file_data, expected):
    assert attachments_include_video([file_data]) is expected


def test_standard_text_turn_uses_default_without_locking_route():
    selection = resolve_primary_model(thinking_mode="standard", files=[])

    assert selection.model_id == DEFAULT_MODEL_ID
    assert selection.sticky_route is None


def test_video_promotes_conversation_to_sticky_glm_video_route():
    selection = resolve_primary_model(
        thinking_mode="standard",
        files=[{"name": "demo.mp4", "type": "video/mp4"}],
    )

    assert selection.model_id == VIDEO_MODEL_ID
    assert selection.model_id == "z-ai/glm-5.3-flash"
    assert selection.sticky_route == VIDEO_ROUTE

    later_selection = resolve_primary_model(
        thinking_mode="standard",
        files=[],
        sticky_route=selection.sticky_route,
    )
    assert later_selection.model_id == VIDEO_MODEL_ID
    assert later_selection.sticky_route == VIDEO_ROUTE


def test_ultra_promotes_conversation_to_sticky_ultra_route():
    selection = resolve_primary_model(thinking_mode="ULTRA THINK", files=[])

    assert selection.model_id == ULTRA_MODEL_ID
    assert selection.sticky_route == ULTRA_ROUTE

    later_selection = resolve_primary_model(
        thinking_mode="standard",
        files=[],
        sticky_route=selection.sticky_route,
    )
    assert later_selection.model_id == ULTRA_MODEL_ID
    assert later_selection.sticky_route == ULTRA_ROUTE


def test_ultra_rejects_video_in_same_turn():
    with pytest.raises(ModelRoutingError) as exc_info:
        resolve_primary_model(
            thinking_mode="ultra",
            files=[{"name": "demo.webm", "type": "video/webm"}],
        )

    assert exc_info.value.code == "ultra_video_not_supported"


def test_video_route_cannot_switch_to_ultra():
    with pytest.raises(ModelRoutingError) as exc_info:
        resolve_primary_model(thinking_mode="ultra", files=[], sticky_route=VIDEO_ROUTE)

    assert exc_info.value.code == "conversation_model_locked_to_video"


def test_ultra_route_cannot_accept_later_video():
    with pytest.raises(ModelRoutingError) as exc_info:
        resolve_primary_model(
            thinking_mode="standard",
            files=[{"name": "demo.mkv", "type": "application/octet-stream"}],
            sticky_route=ULTRA_ROUTE,
        )

    assert exc_info.value.code == "conversation_model_locked_to_ultra"


@pytest.mark.parametrize("raw_value", [None, "", "unexpected", "standard"])
def test_unknown_thinking_modes_are_standard(raw_value):
    assert normalize_thinking_mode(raw_value) == "standard"
