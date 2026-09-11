import base64
import sys
from pathlib import Path

from agno.media import Video
from agno.models.message import Message
from agno.models.openrouter import OpenRouter


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from openrouter_reasoning_model import (  # noqa: E402
    _read_reasoning_config,
    get_openrouter_model,
)


def test_reasoning_defaults_to_xhigh(monkeypatch):
    monkeypatch.delenv("OPENROUTER_REASONING_ENABLED", raising=False)
    monkeypatch.delenv("OPENROUTER_REASONING_EFFORT", raising=False)
    monkeypatch.delenv("OPENROUTER_REASONING_MAX_TOKENS", raising=False)

    assert _read_reasoning_config() == {"effort": "xhigh", "exclude": False}


def test_reasoning_max_tokens_replaces_effort(monkeypatch):
    monkeypatch.setenv("OPENROUTER_REASONING_EFFORT", "high")
    monkeypatch.setenv("OPENROUTER_REASONING_MAX_TOKENS", "4096")

    assert _read_reasoning_config() == {"max_tokens": 4096, "exclude": False}


def test_openrouter_message_formats_video_bytes_as_data_url():
    video_bytes = b"sample-video"
    message = Message(
        role="user",
        content="Describe this video.",
        videos=[Video(content=video_bytes, mime_type="video/mp4")],
    )

    formatted = get_openrouter_model("z-ai/glm-5.3-flash")._format_message(message)

    assert formatted["content"] == [
        {"type": "text", "text": "Describe this video."},
        {
            "type": "video_url",
            "video_url": {
                "url": f"data:video/mp4;base64,{base64.b64encode(video_bytes).decode('ascii')}"
            },
        },
    ]


def test_openrouter_video_format_hint_sets_data_url_mime_type():
    message = Message(
        role="user",
        content="Describe this video.",
        videos=[Video(content=b"webm-video", format="webm")],
    )

    formatted = get_openrouter_model("z-ai/glm-5.3-flash")._format_message(message)

    assert formatted["content"][1]["video_url"]["url"].startswith("data:video/webm;base64,")


def test_openrouter_message_formatter_supports_agno_2_0_signature(monkeypatch):
    def legacy_format_message(self, message):
        return {"role": message.role, "content": message.content}

    monkeypatch.setattr(OpenRouter, "_format_message", legacy_format_message)
    message = Message(role="user", content="Hello")

    formatted = get_openrouter_model("deepseek/deepseek-v4.1-flash")._format_message(
        message,
        compress_tool_results=True,
    )

    assert formatted == {"role": "user", "content": "Hello"}
