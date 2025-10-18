# python-backend/assistant.py (Final, Refactored for Agno v2.x Direct Multimodal Output)

import os
import base64
import traceback
import logging
import uuid
from typing import Optional, List, Dict, Any, Union

# Agno Core Imports
from agno.agent import Agent
from agno.team import Team
from agno.media import Image
from agno.tools import tool

# V2 Imports
from agno.run.team import TeamRunEvent
from agno.run.agent import RunEvent
from agno.db.postgres import PostgresDb
from agno.models.google import Gemini
from agno.models.groq import Groq

# Tool Imports
from agno.tools import Toolkit
from agno.tools.googlesearch import GoogleSearchTools
from agno.tools.website import WebsiteTools
from agno.tools.hackernews import HackerNewsTools
from agno.tools.wikipedia import WikipediaTools
from agno.tools.arxiv import ArxivTools
from agno.tools.yfinance import YFinanceTools
from agno.tools.crawl4ai import Crawl4aiTools
from sandbox_tools import SandboxTools
from github_tools import GitHubTools
from google_email_tools import GoogleEmailTools
from google_drive_tools import GoogleDriveTools
from browser_tools import BrowserTools
from vercel_tools import VercelTools
from supabase_tools import SupabaseTools

# Other Imports
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

def get_llm_os(
    user_id: Optional[str] = None,
    session_info: Optional[Dict[str, Any]] = None,
    internet_search: bool = False,
    coding_assistant: bool = False,
    World_Agent: bool = False,
    Planner_Agent: bool = True,
    enable_supabase: bool = False,
    use_memory: bool = False,
    debug_mode: bool = True,
    enable_github: bool = False,
    enable_vercel: bool = False,
    enable_google_email: bool = False,
    enable_google_drive: bool = False,
    enable_browser: bool = False,
    browser_tools_config: Optional[Dict[str, Any]] = None,
    # --- CHANGE 1: Removed `custom_tool_config` parameter ---
    # This parameter was only needed for the obsolete image generation workaround.
) -> Team:
    """
    Constructs the hierarchical Aetheria AI multi-agent system with integrated planner.
    """
    direct_tools: List[Toolkit] = []

    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set.")
    db_url_sqlalchemy = db_url_full.replace("postgresql://", "postgresql+psycopg2://")

    db = PostgresDb(
        db_url=db_url_sqlalchemy,
        db_schema="public"
    )

    if enable_github and user_id:
        direct_tools.append(GitHubTools(user_id=user_id))
    if (enable_google_email or enable_google_drive) and user_id:
        if enable_google_email:
            direct_tools.append(GoogleEmailTools(user_id=user_id))
        if enable_google_drive:
            direct_tools.append(GoogleDriveTools(user_id=user_id))
    if internet_search:
        direct_tools.append(GoogleSearchTools(fixed_max_results=15))
    if enable_browser and browser_tools_config:
        logger.info("Browser tools are enabled and configured. Initializing BrowserTools.")
        direct_tools.append(BrowserTools(**browser_tools_config))
    if enable_vercel and user_id:
        direct_tools.append(VercelTools(user_id=user_id))
    if enable_supabase and user_id:
        direct_tools.append(SupabaseTools(user_id=user_id))

    # --- CHANGE 2: The entire old `generate_image` tool function has been deleted. ---
    # It is replaced by the `artist_agent` defined below.

    # This section for building the planner's context remains unchanged and is a good design pattern.
    available_resources = {
        "direct_tools": [],
        "specialist_agents": [],
        "capabilities": []
    }
    if enable_github:
        available_resources["direct_tools"].append("GitHubTools - GitHub repository operations")
    if enable_google_email:
        available_resources["direct_tools"].append("GoogleEmailTools - Email operations")
    if enable_google_drive:
        available_resources["direct_tools"].append("GoogleDriveTools - Google Drive file operations")
    if internet_search:
        available_resources["direct_tools"].append("GoogleSearchTools - Web search capabilities")
    if enable_browser:
        available_resources["direct_tools"].append("BrowserTools - Browser automation and interaction")
    # --- CHANGE 3: Updated available resources to reflect the new agent ---
    available_resources["specialist_agents"].append("artist_agent - AI image generation")
    if enable_vercel:
        available_resources["direct_tools"].append("VercelTools - Vercel project and deployment operations")
    if enable_supabase:
        available_resources["direct_tools"].append("SupabaseTools - database related tool")
    if coding_assistant:
        available_resources["specialist_agents"].append("dev_team - Code development, testing, file operations, terminal commands")
        available_resources["capabilities"].append("Code execution via sandbox")
    if World_Agent:
        available_resources["specialist_agents"].append("World_Agent - Wikipedia, ArXiv, HackerNews, YFinance, web crawling")
        available_resources["capabilities"].append("Research and data extraction")

    main_team_members: List[Union[Agent, Team]] = []

    if Planner_Agent:
        resources_summary = "\n".join([
            "AVAILABLE DIRECT TOOLS:",
            *[f"• {tool}" for tool in available_resources["direct_tools"]],
            "", "AVAILABLE SPECIALIST AGENTS:",
            *[f"• {agent}" for agent in available_resources["specialist_agents"]],
            "", "SYSTEM CAPABILITIES:",
            *[f"• {cap}" for cap in available_resources["capabilities"]]
        ])

        planner = Agent(
            name="planner",
            role="Strategic planning agent that creates execution plans for complex multi-step tasks",
            model=Groq(id="moonshotai/kimi-k2-instruct-0905"),
            instructions=[
                "You are the Strategic Planner for Aetheria AI. Your role is to analyze complex queries and create clear, actionable execution plans.",
                "", "ACCESS: You receive queries from session_state['turn_context']",
                "", resources_summary,
                "", "PLANNING APPROACH:",
                "1. Analyze the user's request to identify all requirements",
                "2. Break down complex tasks into atomic, sequential steps",
                "3. Identify which tools/agents are needed for each step",
                "4. Consider dependencies between steps",
                "5. Optimize for efficiency and accuracy",
                "", "PLAN FORMAT:",
                "• Keep plans concise: 3-7 steps maximum",
                "• One line per step, clear and actionable",
                "• Each step should specify: ACTION → TOOL/AGENT → EXPECTED OUTPUT",
                "• Example format:",
                "  Step 1: Search for latest research papers → World_Agent (ArXiv) → Get 5 recent papers",
                "  Step 2: Analyze findings → Direct analysis → Synthesize key insights",
                "  Step 3: Generate visualization → artist_agent → Create infographic",
                "", "WHEN TO CREATE PLANS:",
                "• Multi-step workflows requiring different tools",
                "• Tasks needing coordination between agents",
                "• Complex analysis requiring sequential processing",
                "• Projects with clear phases (research → analyze → create)",
                "", "OUTPUT:",
                "Return ONLY the execution plan in the specified format.",
                "Do not execute tasks yourself - only plan.",
                "Be specific about which agent/tool handles each step."
            ],
            markdown=True,
            debug_mode=debug_mode,
        )
        main_team_members.append(planner)

    if coding_assistant:
        dev_team = Team(
            name="dev_team",
            model=Gemini(id="gemini-2.5-flash-preview-09-2025"),
            members=[],
            tools=[SandboxTools(session_info=session_info)] if session_info else [],
            instructions=[
                "Development team: Plan and execute code solutions using sandbox tools.",
                "Access files from session_state['turn_context']['files'].",
                "Workflow: 1) Analyze requirements 2) Plan solution 3) Implement code 4) Test & verify.",
                "Use sandbox tools for file operations, code execution, terminal commands, testing.",
                "Output: Brief summary + working code + test results.",
                "Keep responses focused and under 300 words unless complex implementation needed."
            ],
            debug_mode=debug_mode
        )
        main_team_members.append(dev_team)

    if World_Agent:
        world_ai = Agent(
            name="World_Agent",
            role="Universal knowledge and research agent with access to world information.",
            model=Gemini(id="gemini-2.5-flash-lite-preview-09-2025"),
            tools=[YFinanceTools(),WikipediaTools(),HackerNewsTools(),ArxivTools(),WebsiteTools(),Crawl4aiTools(max_length=None)],
            instructions=[
                "You are the World Agent with comprehensive access to global information sources.",
                "Access context from session_state['turn_context'] for queries.",
                "", "AVAILABLE TOOLS:",
                "• WikipediaTools - Encyclopedic knowledge and factual information",
                "• ArxivTools - Academic papers and research publications",
                "• HackerNewsTools - Tech news, startup discussions",
                "• Crawl4aiTools - Advanced web scraping for dynamic content",
                "• WebsiteTools - Deep website content extraction",
                "• YFinanceTools - Stock prices, company info, analyst recommendations",
                "", "TOOL SELECTION LOGIC:",
                "• General knowledge queries → Wikipedia",
                "• Academic/research papers → ArXiv",
                "• Tech news/trends → HackerNews",
                "• URL content extraction → Crawl4ai or WebsiteTools",
                "• Financial/stock data → YFinance",
                "", "OUTPUT:",
                "• Deliver clear, comprehensive responses",
                "• Structure information logically",
                "• Include relevant data points and insights",
                "• Keep responses concise yet thorough"
            ],
            markdown=True,
            debug_mode=debug_mode,
        )
        main_team_members.append(world_ai)
        
    # --- CHANGE 4: Define the new, framework-native artist agent ---
    artist_agent = Agent(
        name="artist_agent",
        model=Gemini(
            id="gemini-2.0-flash-exp-image-generation",
            response_modalities=["Text", "Image"],
        ),
        debug_mode=debug_mode,
    )
    main_team_members.append(artist_agent)


    aetheria_instructions = [
        "You are Aetheria AI, the world's most advanced AI. You lead a team of specialist agents. Your primary goal is to provide direct, clear, and valuable responses to the user.",
        "Access context via session_state['turn_context'].",

        "\n--- CORE WORKFLOW ---\n"
        "1.  **ASSESS COMPLEXITY:** If the user's request is complex or requires multiple steps/agents, delegate to the `planner`  agent first. Otherwise, handle it directly.",
        "2.  **EXECUTE:** Based on the assessment or the planner's output, delegate tasks to the appropriate specialist agent or use your own tools.",
        "3.  **SYNTHESIZE & RESPOND:** Compile the results from your team and present a final, cohesive answer to the user. Your response should be from you, Aetheria AI, not a summary of your agents' work.",

        "\n--- ROUTING GUIDE ---\n"
        "•   **Coding/Terminal/Files:** Delegate to `dev_team` .",
        "•   **Web Research/Data Extraction:** Delegate to `World_Agent` .",
        "•   **Image Generation/Drawing:** Delegate to `artist_agent` .",
        "•   **Browser Interaction:** Use `browser_tools` .",
        "•   **Vercel/Supabase Management:** Use `VercelTools`  or `SupabaseTools` .",
        "•   **Simple Web Search:** Use `GoogleSearchTools` .",

        "\n--- RESPONSE STYLE ---\n"
        "•   Be direct, confident, and conversational.",
        "•   Do not explain your internal processes (e.g., 'I will now delegate...'). Just present the final result.",
        "•   Focus on user value.",
    ]

    llm_os_team = Team(
        name="Aetheria_AI",
        model=Gemini(id="gemini-2.5-flash-preview-09-2025"),
        members=main_team_members,
        tools=direct_tools,
        instructions=aetheria_instructions,
        user_id=user_id,
        db=db,
        enable_agentic_memory=use_memory,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        stream_intermediate_steps=True,
        search_knowledge=use_memory,
        events_to_skip=[
            TeamRunEvent.run_started,
            TeamRunEvent.run_completed,
            TeamRunEvent.memory_update_started,
            TeamRunEvent.memory_update_completed,
        ],
        read_team_history=True,
        add_history_to_context=True,
        num_history_runs=40,
        store_events=True,
        markdown=True,
        add_datetime_to_context=True,
        debug_mode=debug_mode,
    )

    return llm_os_team