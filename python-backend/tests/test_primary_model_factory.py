import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from model_routing import DEEPSEEK_MODEL_ID, GLM_VIDEO_MODEL_ID  # noqa: E402
from openrouter_reasoning_model import OpenRouterReasoning  # noqa: E402
from primary_model_factory import get_primary_model  # noqa: E402


def test_primary_route_uses_deepseek_through_openrouter():
    model = get_primary_model(DEEPSEEK_MODEL_ID)

    assert isinstance(model, OpenRouterReasoning)
    assert model.id == "deepseek/deepseek-v4.1-flash"


def test_video_route_uses_glm_through_openrouter():
    model = get_primary_model(GLM_VIDEO_MODEL_ID)

    assert isinstance(model, OpenRouterReasoning)
    assert model.id == "z-ai/glm-5.3-flash"
