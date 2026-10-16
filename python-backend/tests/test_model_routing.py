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


def test_video_uses_shared_model_without_locking_conversation_mode():
    selection = resolve_primary_model(
        thinking_mode="standard",
        files=[{"name": "demo.mp4", "type": "video/mp4"}],
    )

    assert selection.model_id == VIDEO_MODEL_ID
    assert selection.model_id == "xiaomi/mimo-v2.6-pro"
    assert selection.sticky_route is None

    later_selection = resolve_primary_model(
        thinking_mode="standard",
        files=[],
        sticky_route=selection.sticky_route,
    )
    assert later_selection.model_id == VIDEO_MODEL_ID
    assert later_selection.sticky_route is None


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


@pytest.mark.parametrize("mode", ["standard", "ultra"])
@pytest.mark.parametrize("route", [None, VIDEO_ROUTE, ULTRA_ROUTE])
@pytest.mark.parametrize("files", [
    [],
    [{"name": "notes.txt", "type": "text/plain", "isText": True, "content": "Read this"}],
    [{"name": "photo.png", "type": "image/png"}],
    [{"name": "recording.wav", "type": "audio/wav"}],
    [{"name": "demo.webm", "type": "video/webm"}],
    [{"name": "demo.mkv", "type": "application/octet-stream"}],
    [{"name": "photo.png", "type": "image/png"},
     {"name": "recording.wav", "type": "audio/wav"},
     {"name": "demo.mp4", "type": "video/mp4"}],
])
def test_all_media_are_accepted_with_current_and_legacy_routes(mode, route, files):
    selection = resolve_primary_model(thinking_mode=mode, files=files, sticky_route=route)

    assert selection.model_id == DEFAULT_MODEL_ID == ULTRA_MODEL_ID == VIDEO_MODEL_ID
    assert selection.has_video is attachments_include_video(files)
    assert selection.sticky_route == (ULTRA_ROUTE if mode == "ultra" or route == ULTRA_ROUTE else None)


@pytest.mark.parametrize("raw_value", [None, "", "unexpected", "standard"])
def test_unknown_thinking_modes_are_standard(raw_value):
    assert normalize_thinking_mode(raw_value) == "standard"
