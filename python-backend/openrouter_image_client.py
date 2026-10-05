"""Generate raster images through OpenRouter without paid-provider fallbacks."""

import base64
import binascii
import io
import logging
import os
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlsplit

import requests
from PIL import Image as PillowImage, UnidentifiedImageError

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1"
TEXT_IMAGE_MODEL = "inclusionai/ming-image-0.1-design"
REFERENCE_IMAGE_MODEL = "inclusionai/ming-image-0.1-design-layer"
MAX_IMAGE_BYTES = 20 * 1024 * 1024
RASTER_MIME_TYPES = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


class ImageGenerationError(RuntimeError):
    """An actionable image-generation failure safe to return in a tool result."""


@dataclass(frozen=True)
class GeneratedImage:
    content: bytes
    mime_type: str
    model: str


def validate_image_bytes(content: bytes) -> str:
    """Identify and verify provider bytes before storage or model ingestion."""
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise ImageGenerationError("Image is empty or exceeds the 20 MB limit.")
    try:
        with PillowImage.open(io.BytesIO(content)) as image:
            mime_type = RASTER_MIME_TYPES.get(image.format)
            if not mime_type:
                raise ImageGenerationError("Only PNG, JPEG, and WebP images are supported.")
            image.verify()
            return mime_type
    except (UnidentifiedImageError, OSError, SyntaxError, PillowImage.DecompressionBombError) as exc:
        raise ImageGenerationError("The image contains invalid raster data.") from exc


def validate_reference_url(value: str) -> str:
    """Accept provider-readable URLs, never backend-local paths or credentials."""
    if not isinstance(value, str) or not value.strip():
        raise ImageGenerationError("Image input must be an HTTP(S) URL or a base64 image data URL.")
    value = value.strip()
    if value.startswith("data:"):
        header, separator, encoded = value.partition(",")
        if not separator or header not in {
            "data:image/png;base64", "data:image/jpeg;base64", "data:image/webp;base64"
        }:
            raise ImageGenerationError("Reference data URLs must contain a PNG, JPEG, or WebP image.")
        content = _decode_base64(encoded)
        actual_mime = validate_image_bytes(content)
        if header != f"data:{actual_mime};base64":
            raise ImageGenerationError("Reference image format does not match its data URL.")
        return value
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Unsupported URL")
        # Accessing port validates malformed port values as well.
        _ = parsed.port
    except ValueError as exc:
        raise ImageGenerationError("Image input must be an HTTP(S) URL without embedded credentials.") from exc
    return value


def _decode_base64(encoded: Any) -> bytes:
    if not isinstance(encoded, str) or len(encoded) > ((MAX_IMAGE_BYTES + 2) // 3) * 4:
        raise ImageGenerationError("Image data is missing or exceeds the 20 MB limit.")
    try:
        return base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ImageGenerationError("Image data is not valid base64.") from exc


def _free_provider(payload: Any, reference_count: int) -> str:
    """Pin a zero-price endpoint whose reference limits match this request."""
    endpoints = payload.get("endpoints") if isinstance(payload, dict) else None
    if not isinstance(endpoints, list):
        raise ImageGenerationError("OpenRouter returned an invalid image endpoint catalog.")
    for endpoint in endpoints:
        if not isinstance(endpoint, dict):
            continue
        pricing = endpoint.get("pricing")
        if not isinstance(pricing, list) or not pricing:
            continue
        try:
            if any(float(line["cost_usd"]) != 0 for line in pricing):
                continue
        except (KeyError, TypeError, ValueError):
            continue
        parameters = endpoint.get("supported_parameters") or {}
        if not isinstance(parameters, dict):
            continue
        limits = parameters.get("input_references") or {}
        if not isinstance(limits, dict):
            continue
        minimum, maximum = limits.get("min", 0), limits.get("max", 0)
        if not isinstance(minimum, int) or not isinstance(maximum, int):
            continue
        if minimum <= reference_count <= maximum:
            provider = endpoint.get("provider_tag")
            if isinstance(provider, str) and provider:
                return provider
    raise ImageGenerationError(
        "No free image endpoint supports this input. Check the configured model and its reference limits."
    )


def generate_openrouter_image(api_key: str, text: str, reference: Optional[str] = None) -> GeneratedImage:
    """Submit one text or image-guided request, with a current zero-price check."""
    if not api_key:
        raise ImageGenerationError("Image generation requires OPENROUTER_API_KEY on the server.")
    if not isinstance(text, str) or not text.strip() or len(text) > 20_000:
        raise ImageGenerationError("Text must contain between 1 and 20,000 characters.")
    if reference is not None:
        reference = validate_reference_url(reference)
    model = os.getenv(
        "OPENROUTER_IMAGE_EDIT_MODEL" if reference else "OPENROUTER_IMAGE_MODEL",
        REFERENCE_IMAGE_MODEL if reference else TEXT_IMAGE_MODEL,
    ).strip()
    if not model or any(part in {"", ".", ".."} for part in model.split("/")):
        raise ImageGenerationError("The configured OpenRouter image model is invalid.")
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    try:
        catalog = requests.get(f"{OPENROUTER_URL}/images/models/{model}/endpoints", headers=headers, timeout=30)
        catalog.raise_for_status()
        provider = _free_provider(catalog.json(), int(reference is not None))
        payload: dict[str, Any] = {
            "model": model,
            "prompt": text.strip(),
            "n": 1,
            "provider": {"only": [provider], "allow_fallbacks": False},
        }
        if reference:
            payload["input_references"] = [{"type": "image_url", "image_url": {"url": reference}}]
        response = requests.post(f"{OPENROUTER_URL}/images", headers=headers, json=payload, timeout=(30, 300))
        response.raise_for_status()
        result = response.json()
    except requests.Timeout as exc:
        raise ImageGenerationError("OpenRouter image generation timed out. Try again.") from exc
    except requests.RequestException as exc:
        status = getattr(exc.response, "status_code", None)
        logger.warning("OpenRouter image request failed, status=%s", status)
        if status == 402:
            raise ImageGenerationError(
                "OpenRouter refused image generation (HTTP 402). Check the account's credits and key limits, "
                "even when the selected image model is free."
            ) from exc
        raise ImageGenerationError(f"OpenRouter image request failed{f' (HTTP {status})' if status else ''}. Try again.") from exc
    except ValueError as exc:
        raise ImageGenerationError("OpenRouter returned invalid JSON for image generation.") from exc
    data = result.get("data") if isinstance(result, dict) else None
    if not isinstance(data, list) or not data or not isinstance(data[0], dict):
        raise ImageGenerationError("OpenRouter completed the request without returning an image.")
    content = _decode_base64(data[0].get("b64_json"))
    mime_type = validate_image_bytes(content)
    return GeneratedImage(content=content, mime_type=mime_type, model=model)
