# python-backend/system_assistant.py

import logging

# Agno Imports
from agno.agent import Agent
from agno.models.google import Gemini

# Tools
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.wikipedia import WikipediaTools

logger = logging.getLogger(__name__)

def get_system_assistant() -> Agent:
    """
    Constructs a lightweight, stateless System Assistant Agent.
    
    Designed for fast, direct responses without session persistence.
    Perfect for voice assistant and Circle to Search use cases.
    Supports multimodal inputs (text + images).
    """
    # Instructions - optimized for voice/mobile and visual understanding
    system_instructions = [
        "You are Aetheria, an AI assistant for mobile voice and visual interactions.",
        "",
        "RESPONSE STYLE:",
        "• BE CONCISE - users are on mobile devices",
        "• Direct answers, no lengthy explanations",
        "• Natural, conversational language",
        "• Focus on being helpful and accurate",
        "• Analyze screenshots and images from Circle to Search",
        "",
        "VISUAL ANALYSIS (Circle to Search):",
        "• When provided with a screenshot, analyze what's visible",
        "• Identify text, UI elements, content, or objects in the image",
        "• Provide helpful context or explanations about what you see",
        "• If text is visible, you can read and explain it",
        "• If it's a UI element, explain what it does",
        "• Keep visual descriptions brief and actionable",
        "• Combine visual context with the user's question for best results",
    ]

    # Agent - simple, fast, and multimodal
    agent = Agent(
        name="Aetheria_System_Assistant",
        model=Gemini(id="gemini-2.5-flash-lite"),
        instructions=system_instructions,
        markdown=True,
        debug_mode=True,
    )

    return agent
