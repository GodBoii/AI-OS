# python-backend/system_assistant.py

import logging
from typing import Any, Dict, Optional

# Agno Imports
from agno.agent import Agent
from agno.models.openrouter import OpenRouter

logger = logging.getLogger(__name__)

try:
    from mobile_tools import MobileTools
except Exception as exc:
    MobileTools = None
    logger.warning("MobileTools import failed in system_assistant: %s", exc)


def _create_mobile_tools(mobile_tools_config: Optional[Dict[str, Any]]):
    """
    Build MobileTools only when full realtime bridge context is available.
    """
    if not mobile_tools_config:
        return None
    if MobileTools is None:
        logger.warning("Mobile tools requested but MobileTools class is unavailable.")
        return None

    sid = str(mobile_tools_config.get("sid") or "").strip()
    socketio = mobile_tools_config.get("socketio")
    redis_client = mobile_tools_config.get("redis_client")

    if not sid or not socketio or not redis_client:
        logger.info(
            "Skipping mobile tools injection due to missing runtime context "
            "(sid/socketio/redis_client)."
        )
        return None

    try:
        return MobileTools(
            sid=sid,
            socketio=socketio,
            redis_client=redis_client,
            message_id=mobile_tools_config.get("message_id"),
            conversation_id=mobile_tools_config.get("conversation_id"),
        )
    except Exception as exc:
        logger.error("Failed to initialize MobileTools: %s", exc, exc_info=True)
        return None


def get_system_assistant(
    *,
    mobile_tools_config: Optional[Dict[str, Any]] = None,
    enable_mobile_tools: bool = True,
) -> Agent:
    """
    Constructs a lightweight, stateless System Assistant Agent.

    Designed for fast, direct responses without session persistence.
    Supports multimodal inputs (text + images).
    Optionally supports realtime mobile native tools when runtime bridge
    context (socket + redis + sid) is provided.
    """
    system_instructions = [
        "You are Aetheria, an AI assistant for mobile voice and visual interactions.",
        "",
        "RESPONSE STYLE:",
        "- Be concise and clear for mobile users.",
        "- Prefer direct answers over long explanations.",
        "- Keep language natural and practical.",
        "",
        "VISUAL ANALYSIS (Circle to Search / Mindspace):",
        "- Analyze visible text, UI elements, objects, and context from screenshots.",
        "- Explain what important UI elements do when relevant.",
        "- Combine the image context with the user question.",
        "",
        "MOBILE TOOL USAGE:",
        "- Use available mobile tools when the user asks to inspect or control the device.",
        "- For action tools, execute only what is requested and then report outcome.",
        "- If a tool fails or times out, explain clearly and suggest the next step.",
    ]

    tools = []
    if enable_mobile_tools:
        mobile_tools = _create_mobile_tools(mobile_tools_config)
        if mobile_tools:
            tools.append(mobile_tools)

    agent_kwargs: Dict[str, Any] = {
        "name": "Aetheria_System_Assistant",
        "model": OpenRouter(id="openrouter/healer-alpha"),
        "instructions": system_instructions,
        "markdown": True,
        "debug_mode": True,
    }
    if tools:
        agent_kwargs["tools"] = tools

    return Agent(**agent_kwargs)
