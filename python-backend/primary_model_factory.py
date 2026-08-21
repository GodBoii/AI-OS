"""Construct primary-agent models from server-owned routing IDs."""

from typing import Any

from model_routing import VIDEO_MODEL_ID
from openrouter_reasoning_model import get_openrouter_model


def get_primary_model(model_id: str) -> Any:
    """Use native Gemini for video and OpenRouter for existing text/image routes."""
    if model_id == VIDEO_MODEL_ID:
        from agno.models.google import Gemini

        return Gemini(id=model_id.split("/", 1)[1])
    return get_openrouter_model(model_id)
