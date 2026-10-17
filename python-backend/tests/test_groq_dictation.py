"""Provider contracts and authenticated route behavior without external services."""
import ast
import base64
import logging
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import groq_dictation as dictation

AUDIO = base64.b64encode(b"test audio bytes").decode()


def test_provider_contract_and_literal_response(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "private-server-key")
    post = Mock(return_value=Mock(ok=True, status_code=200, json=lambda: {"text": "no, I meant tomorrow"}))
    monkeypatch.setattr(dictation.requests, "post", post)
    assert dictation.transcribe(AUDIO) == "no, I meant tomorrow"
    args, kwargs = post.call_args
    assert args == (dictation.TRANSCRIPTION_URL,)
    assert kwargs["data"] == {"model": "whisper-large-v3", "response_format": "json", "temperature": "0"}
    assert kwargs["headers"] == {"Authorization": "Bearer private-server-key"}
    assert kwargs["files"] == {"file": ("dictation.webm", b"test audio bytes")}
    dictation.transcribe(AUDIO, "wav", "hi")
    assert post.call_args.kwargs["data"]["language"] == "hi"


@pytest.mark.parametrize("audio,fmt,language", [(None, "webm", ""), ("!", "webm", ""),
    (AUDIO, "exe", ""), (AUDIO, "webm", "English"), (AUDIO, {}, ""), (AUDIO, "webm", [])])
def test_invalid_input_never_reaches_provider(monkeypatch, audio, fmt, language):
    post = Mock()
    monkeypatch.setattr(dictation.requests, "post", post)
    with pytest.raises(dictation.DictationError):
        dictation.transcribe(audio, fmt, language)
    post.assert_not_called()


def test_size_and_missing_credentials(monkeypatch):
    monkeypatch.setattr(dictation, "MAX_AUDIO_BYTES", 2)
    with pytest.raises(dictation.DictationError) as error:
        dictation.transcribe(AUDIO)
    assert error.value.status == 413
    monkeypatch.setattr(dictation, "MAX_AUDIO_BYTES", 100)
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    with pytest.raises(dictation.DictationError) as error:
        dictation.transcribe(AUDIO)
    assert error.value.status == 503


@pytest.mark.parametrize("status,expected", [(429, 429), (401, 503), (403, 503), (500, 502)])
def test_provider_failure_is_sanitized(monkeypatch, status, expected):
    monkeypatch.setenv("GROQ_API_KEY", "secret")
    monkeypatch.setattr(dictation.requests, "post", Mock(return_value=Mock(status_code=status, ok=False)))
    with pytest.raises(dictation.DictationError) as error:
        dictation.transcribe(AUDIO)
    assert error.value.status == expected
    assert "secret" not in str(error.value)


@pytest.mark.parametrize("payload", [{}, {"text": 12}, [], None])
def test_invalid_response(monkeypatch, payload):
    monkeypatch.setenv("GROQ_API_KEY", "secret")
    monkeypatch.setattr(dictation.requests, "post", Mock(return_value=Mock(ok=True, status_code=200, json=lambda: payload)))
    with pytest.raises(dictation.DictationError) as error:
        dictation.transcribe(AUDIO)
    assert error.value.status == 502


@pytest.mark.parametrize("exception,status", [(requests.Timeout(), 504), (requests.ConnectionError(), 502)])
def test_network_errors(monkeypatch, exception, status):
    monkeypatch.setenv("GROQ_API_KEY", "secret")
    monkeypatch.setattr(dictation.requests, "post", Mock(side_effect=exception))
    with pytest.raises(dictation.DictationError) as error:
        dictation.transcribe(AUDIO)
    assert error.value.status == status


def test_authenticated_route(monkeypatch):
    # Load the real route without booting databases, Redis, or unrelated agents.
    from flask import Flask, jsonify, request
    tree = ast.parse((Path(__file__).resolve().parents[1] / "api.py").read_text(encoding="utf-8"))
    route = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "mic_dictate")
    route.decorator_list = []
    check = Mock()
    namespace = {"get_user_from_token": lambda request: (SimpleNamespace(id="user"), None),
        "enforce_usage_limit": check, "UsageLimitExceeded": type("UsageLimitExceeded", (Exception,), {}),
        "jsonify": jsonify, "request": request, "logger": logging.getLogger(__name__)}
    exec(compile(ast.Module(body=[route], type_ignores=[]), "api.py", "exec"), namespace)
    app = Flask(__name__)
    app.add_url_rule("/api/mic/dictate", view_func=namespace["mic_dictate"], methods=["POST"])
    client = app.test_client()
    transcribe = Mock(return_value="literal speech")
    monkeypatch.setattr(dictation, "transcribe", transcribe)
    response = client.post("/api/mic/dictate", json={"audio": AUDIO})
    assert response.status_code == 200
    assert response.json == {"ok": True, "text": "literal speech", "backend": "groq", "model": "whisper-large-v3"}
    check.assert_called_once_with("user")
    transcribe.reset_mock()
    namespace["get_user_from_token"] = lambda request: (None, ("Unauthorized", 401))
    assert client.post("/api/mic/dictate", json={"audio": AUDIO}).status_code == 401
    transcribe.assert_not_called()
    namespace["get_user_from_token"] = lambda request: (SimpleNamespace(id="user"), None)
    assert client.post("/api/mic/dictate", json=[]).status_code == 400
    limit_error = namespace["UsageLimitExceeded"]("Daily usage reached")
    limit_error.summary = {"remaining": 0}
    check.side_effect = limit_error
    response = client.post("/api/mic/dictate", json={"audio": AUDIO})
    assert response.status_code == 429
    assert response.json["code"] == "subscription_limit_exceeded"
    assert response.json["limit_info"] == {"remaining": 0}
    check.side_effect = RuntimeError("storage unavailable")
    assert client.post("/api/mic/dictate", json={"audio": AUDIO}).status_code == 503
    transcribe.assert_not_called()
