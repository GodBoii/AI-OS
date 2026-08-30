"""Construct primary-agent models from server-owned routing IDs."""

from typing import Any

from openrouter_reasoning_model import get_openrouter_model


def get_primary_model(model_id: str) -> Any:
    """Build the OpenRouter model selected by the primary routing layer."""
    return get_openrouter_model(model_id)
