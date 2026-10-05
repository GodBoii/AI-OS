"""Check provider contracts without spending credits or requiring storage."""

import base64
import io
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from openrouter_image_client import (  # noqa: E402
    ImageGenerationError,
    REFERENCE_IMAGE_MODEL,
    TEXT_IMAGE_MODEL,
    generate_openrouter_image,
    validate_reference_url,
)


@pytest.fixture
def png():
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), "red").save(buffer, format="PNG")
    return buffer.getvalue()


def catalog(minimum=0, maximum=0, cost=0):
    return {"endpoints": [{
        "provider_tag": "novita",
        "pricing": [{"cost_usd": cost}],
        "supported_parameters": {"input_references": {"min": minimum, "max": maximum}},
    }]}


@pytest.fixture
def provider(monkeypatch, png):
    monkeypatch.delenv("OPENROUTER_IMAGE_MODEL", raising=False)
    monkeypatch.delenv("OPENROUTER_IMAGE_EDIT_MODEL", raising=False)
    get = Mock(return_value=Mock(json=lambda: catalog()))
    post = Mock(return_value=Mock(json=lambda: {"data": [{"b64_json": base64.b64encode(png).decode()}]}))
    monkeypatch.setattr(requests, "get", get)
    monkeypatch.setattr(requests, "post", post)
    return get, post


def test_text_request_uses_free_image_api(provider, png):
    get, post = provider
    result = generate_openrouter_image("test-key", "  a red square  ")
    assert result.content == png
    assert result.mime_type == "image/png"
    assert result.model == TEXT_IMAGE_MODEL
    assert get.call_args.args[0].endswith(f"/{TEXT_IMAGE_MODEL}/endpoints")
    assert post.call_args.args[0].endswith("/api/v1/images")
    assert post.call_args.kwargs["json"] == {
        "model": TEXT_IMAGE_MODEL, "prompt": "a red square", "n": 1,
        "provider": {"only": ["novita"], "allow_fallbacks": False},
    }


def test_reference_request_uses_one_image_endpoint(provider, png):
    get, post = provider
    get.return_value.json = lambda: catalog(1, 1)
    reference = "data:image/png;base64," + base64.b64encode(png).decode()
    result = generate_openrouter_image("test-key", "turn it blue", reference)
    assert result.model == REFERENCE_IMAGE_MODEL
    assert post.call_args.kwargs["json"]["input_references"] == [
        {"type": "image_url", "image_url": {"url": reference}}
    ]


@pytest.mark.parametrize("cost", [0.01, -1, "unknown", None])
def test_never_submits_to_paid_or_unknown_price_endpoint(provider, cost):
    get, post = provider
    get.return_value.json = lambda: catalog(cost=cost)
    with pytest.raises(ImageGenerationError, match="No free image endpoint"):
        generate_openrouter_image("test-key", "a tree")
    post.assert_not_called()


def test_reference_limits_are_checked_before_submission(provider):
    _, post = provider
    with pytest.raises(ImageGenerationError, match="reference limits"):
        generate_openrouter_image("test-key", "a tree", "https://example.com/tree.png")
    post.assert_not_called()


@pytest.mark.parametrize("parameters", ["invalid", {"input_references": "invalid"}])
def test_malformed_endpoint_capabilities_never_submit(provider, parameters):
    get, post = provider
    payload = catalog()
    payload["endpoints"][0]["supported_parameters"] = parameters
    get.return_value.json = lambda: payload
    with pytest.raises(ImageGenerationError, match="No free image endpoint"):
        generate_openrouter_image("test-key", "a tree")
    post.assert_not_called()


def test_account_credit_error_is_clear_even_for_free_models(provider):
    _, post = provider
    response = requests.Response()
    response.status_code = 402
    post.side_effect = requests.HTTPError("provider body", response=response)
    with pytest.raises(ImageGenerationError, match="credits and key limits"):
        generate_openrouter_image("test-key", "a tree")


@pytest.mark.parametrize("value", ["", "file:///etc/passwd", "C:/image.png", "javascript:alert(1)",
                                   "https://user:pass@example.com/a.png", "data:image/png;base64,bad",
                                   "data:image/svg+xml;base64,PHN2Zy8+", "https://example.com:bad/a.png"])
def test_rejects_bad_reference_inputs(value):
    with pytest.raises(ImageGenerationError):
        validate_reference_url(value)


@pytest.mark.parametrize("payload", [{}, {"data": []}, {"data": [{}]},
                                      {"data": [{"b64_json": "bad"}]},
                                      {"data": [{"b64_json": "bm90LWFuLWltYWdl"}]}])
def test_rejects_missing_or_invalid_provider_images(provider, payload):
    _, post = provider
    post.return_value.json = lambda: payload
    with pytest.raises(ImageGenerationError):
        generate_openrouter_image("test-key", "a tree")


def test_error_does_not_expose_provider_body_or_key(provider):
    _, post = provider
    response = requests.Response()
    response.status_code = 429
    post.side_effect = requests.HTTPError("secret provider body and test-key", response=response)
    with pytest.raises(ImageGenerationError) as error:
        generate_openrouter_image("test-key", "a tree")
    assert "429" in str(error.value)
    assert "test-key" not in str(error.value)
    assert "secret" not in str(error.value)


def test_timeout_returns_actionable_error(provider):
    _, post = provider
    post.side_effect = requests.Timeout()
    with pytest.raises(ImageGenerationError, match="timed out"):
        generate_openrouter_image("test-key", "a tree")


@pytest.mark.parametrize("text", ["", "  ", "a" * 20_001])
def test_invalid_text_never_calls_provider(provider, text):
    get, post = provider
    with pytest.raises(ImageGenerationError, match="Text must"):
        generate_openrouter_image("test-key", text)
    get.assert_not_called()
    post.assert_not_called()
