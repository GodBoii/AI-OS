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
from agno.tools.function import ToolResult
from PIL import Image as PillowImage

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from openrouter_image_client import GeneratedImage, ImageGenerationError, TEXT_IMAGE_MODEL  # noqa: E402
from primary_model_factory import get_primary_model  # noqa: E402
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


def test_generated_media_reaches_real_primary_model_formatter(toolkit, png):
    result = toolkit.create_image("a red square")
    model = get_primary_model("deepseek/deepseek-v4.1-flash")
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
    assert "generate_image" in toolkit.functions
    assert "generate_video" in toolkit.functions


def test_attached_image_is_forwarded_to_provider(toolkit, module, png):
    toolkit.create_image("make it blue", images=[Image(content=png)])
    reference = module.generate_openrouter_image.call_args.args[2]
    assert reference == "data:image/png;base64," + base64.b64encode(png).decode()


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
    result = toolkit.create_image("edit", session_state={"turn_context": {"files": [
        {"type": "image/png", "path": "user/conversation/photo.png"}
    ]}})
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
