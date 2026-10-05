"""Exercise the real Agno tool and event payload, with external storage mocked."""

import base64
import importlib.util
import io
import json
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

import pytest
from agno.media import Image
from agno.models.message import Message
from agno.tools.function import FunctionCall, ToolResult
from PIL import Image as PillowImage

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from openrouter_image_client import GeneratedImage, ImageGenerationError, TEXT_IMAGE_MODEL  # noqa: E402
from primary_model_factory import get_primary_model  # noqa: E402
from model_routing import DEFAULT_MODEL_ID  # noqa: E402
from tool_event_payload import serialize_tool_event  # noqa: E402


@pytest.fixture
def module(monkeypatch):
    persistence = ModuleType("sandbox_persistence")
    persistence.get_persistence_service = Mock()
    supabase = ModuleType("supabase_client")
    supabase.supabase_client = Mock()
    monkeypatch.setitem(sys.modules, "sandbox_persistence", persistence)
    monkeypatch.setitem(sys.modules, "supabase_client", supabase)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    spec = importlib.util.spec_from_file_location("test_media_tools", BACKEND / "media_tools.py")
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


@pytest.fixture
def png():
    buffer = io.BytesIO()
    PillowImage.new("RGB", (8, 8), "red").save(buffer, format="PNG")
    return buffer.getvalue()


@pytest.fixture
def toolkit(module, png, monkeypatch):
    tool = module.MediaTools({
        "socketio": Mock(), "sid": "socket", "message_id": "message",
        "conversation_id": "conversation", "user_id": "user",
    })
    monkeypatch.setattr(module, "generate_openrouter_image", Mock(
        return_value=GeneratedImage(png, "image/png", TEXT_IMAGE_MODEL)
    ))
    tool._persist_generated_media = Mock(return_value=("artifact", "https://example.com/image.png", "image.png"))
    return tool


def test_tool_returns_same_image_to_model_and_conversation(toolkit, png):
    result = toolkit.create_image("a red square")
    assert isinstance(result, ToolResult)
    assert result.images[0].content == png
    payload = json.loads(result.content)
    assert payload["ok"] is True
    assert "```image\nartifact\n```" in payload["message"]
    assert payload["metadata"]["media_url"] == "https://example.com/image.png"
    event = toolkit.socketio.emit.call_args
    assert event.args[0] == "media_generated"
    assert event.args[1]["artifactId"] == "artifact"
    assert event.kwargs == {"room": "conv:conversation"}
    serialized = serialize_tool_event({"tool_name": "create_image", "result": result.content})
    assert serialized["metadata"] == payload["metadata"]


def test_actual_cost_is_returned_and_sent_to_persistence(toolkit, module, png):
    module.generate_openrouter_image.return_value = GeneratedImage(png, "image/png", TEXT_IMAGE_MODEL, 0.002218)
    result = toolkit.create_image("a green bicycle")
    assert json.loads(result.content)["metadata"]["cost_usd"] == 0.002218
    assert toolkit._persist_generated_media.call_args.kwargs["provider_response"]["cost_usd"] == 0.002218


def test_generated_media_reaches_real_primary_model_formatter(toolkit, png):
    result = toolkit.create_image("a red square")
    model = get_primary_model(DEFAULT_MODEL_ID)
    tool_message = Message(role="tool", content=result.content, tool_call_id="image-call", images=result.images)
    messages = [tool_message]
    model._handle_function_call_media(messages, [tool_message])
    formatted = model._format_message(messages[-1])
    assert formatted["role"] == "user"
    assert formatted["content"][1]["image_url"]["url"] == (
        "data:image/png;base64," + base64.b64encode(png).decode()
    )
    assert tool_message.images is None


def test_tool_schema_exposes_text_and_optional_image(toolkit):
    function = toolkit.functions["create_image"]
    function.process_entrypoint()
    assert "text" in function.parameters["properties"]
    assert "image" in function.parameters["properties"]
    assert "images" not in function.parameters["properties"]
    assert "text" in function.parameters["required"]
    assert "image" not in function.parameters["required"]
    assert set(function.parameters["properties"]) == {"text", "image"}
    assert "generate_image" in toolkit.functions
    assert "generate_video" in toolkit.functions


def test_attached_image_is_forwarded_to_provider(toolkit, module, png):
    toolkit.create_image("make it blue", images=[Image(content=png)])
    reference = module.generate_openrouter_image.call_args.args[2]
    assert reference == "data:image/png;base64," + base64.b64encode(png).decode()


@pytest.mark.parametrize("format,mime_type", [("JPEG", "image/jpeg"), ("WEBP", "image/webp")])
def test_attachment_mime_type_is_preserved(toolkit, module, format, mime_type):
    buffer = io.BytesIO()
    PillowImage.new("RGB", (8, 8), "blue").save(buffer, format=format)
    toolkit.create_image("a blue square", images=[Image(content=buffer.getvalue())])
    assert module.generate_openrouter_image.call_args.args[2].startswith(f"data:{mime_type};base64,")


def test_agno_injects_media_during_actual_tool_call(toolkit, module, png):
    function = toolkit.functions["create_image"]
    function.process_entrypoint()
    function._images = [Image(content=png)]
    call = FunctionCall(function=function, arguments={"text": "make it blue"})
    call.execute()
    assert isinstance(call.result, ToolResult)
    assert call.result.images[0].content == png
    assert module.generate_openrouter_image.call_args.args[2].startswith("data:image/png;base64,")


def test_explicit_reference_selects_image_among_attachments(toolkit, module, png):
    toolkit.create_image("make it blue", image="https://example.com/chosen.png", images=[Image(content=png)] * 2)
    assert module.generate_openrouter_image.call_args.args[2] == "https://example.com/chosen.png"


def test_multiple_attachments_require_selection(toolkit, module, png):
    result = toolkit.create_image("make it blue", images=[Image(content=png)] * 2)
    assert json.loads(result.content)["ok"] is False
    assert result.images is None
    module.generate_openrouter_image.assert_not_called()


def test_inaccessible_attachment_does_not_silently_generate_without_reference(toolkit, module):
    toolkit._create_signed_media_url = Mock(return_value=None)
    toolkit.files = [
        {"type": "image/png", "path": "user/conversation/photo.png"}
    ]
    result = toolkit.create_image("edit")
    assert json.loads(result.content)["ok"] is False
    module.generate_openrouter_image.assert_not_called()


def test_generation_failure_has_no_success_event(toolkit, module):
    module.generate_openrouter_image.side_effect = ImageGenerationError("No free endpoint")
    result = toolkit.create_image("a tree")
    assert json.loads(result.content) == {"ok": False, "error": "No free endpoint"}
    assert not result.images
    toolkit.socketio.emit.assert_not_called()
    toolkit._persist_generated_media.assert_not_called()


def test_storage_failure_is_not_reported_as_success(toolkit):
    toolkit._persist_generated_media.side_effect = RuntimeError("secret storage response")
    result = toolkit.create_image("a tree")
    assert json.loads(result.content)["ok"] is False
    assert "secret" not in result.content
    toolkit.socketio.emit.assert_not_called()


def test_notification_failure_still_returns_saved_image(toolkit, png):
    toolkit.socketio.emit.side_effect = RuntimeError("disconnected")
    result = toolkit.create_image("a tree")
    assert json.loads(result.content)["ok"] is True
    assert result.images[0].content == png


def test_legacy_alias_uses_new_image_path(toolkit, module):
    result = toolkit.generate_image("a tree")
    assert json.loads(result.content)["ok"] is True
    module.generate_openrouter_image.assert_called_once_with("test-key", "a tree", None)


def test_persistence_records_actual_model_and_mime(module, png):
    tool = module.MediaTools({"user_id": "user", "conversation_id": "conversation", "message_id": "message"})
    module.supabase_client.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://example.com/file"}
    module.get_persistence_service.return_value.register_content.return_value = True
    artifact, _, filename = tool._persist_generated_media(
        media_bytes=png, mime_type="image/png", media_kind="image", prompt="tree",
        source_urls=[], provider_response={"model": TEXT_IMAGE_MODEL},
    )
    upload = module.supabase_client.storage.from_.return_value.upload.call_args
    assert upload.args[0] == f"user/conversation/generated/{filename}"
    assert upload.args[1] == png
    registration = module.get_persistence_service.return_value.register_content.call_args.kwargs
    assert registration["reference_id"] == artifact
    assert registration["metadata"]["model"] == TEXT_IMAGE_MODEL
    assert registration["metadata"]["is_generated"] is True


def test_existing_video_tool_still_uses_direct_video_api(toolkit, module, monkeypatch):
    post = Mock(return_value=Mock(json=lambda: {"polling_url": "/api/v1/videos/job"}))
    monkeypatch.setattr(module.requests, "post", post)
    monkeypatch.setattr(module.requests, "get", Mock(return_value=Mock(content=b"video-bytes")))
    toolkit._poll_video_job = Mock(return_value={"status": "completed", "unsigned_urls": ["https://example.com/video.mp4"]})
    result = toolkit.generate_video("a moving bicycle")
    assert "```video\nartifact\n```" in result
    assert post.call_args.args[0] == module.OPENROUTER_VIDEO_URL
    assert post.call_args.kwargs["json"]["model"] == "google/veo-3.1-lite"
    assert toolkit._persist_generated_media.call_args.kwargs["media_bytes"] == b"video-bytes"
    assert toolkit.socketio.emit.call_args.args[1]["mediaType"] == "video"
    module.generate_openrouter_image.assert_not_called()
