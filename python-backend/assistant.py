# python-backend/assistant.py (Final, Corrected Version for Agno v2.0.5)

import os
import base64
import traceback
import logging
import uuid
from typing import Optional, List, Dict, Any, Set, Union, Iterator

# Agno Core Imports
from agno.agent import Agent
from agno.team import Team
from agno.media import Image
from PIL import Image
from agno.tools import tool

# V2 Imports
from agno.run.team import TeamRunEvent
from agno.run.agent import RunEvent
from agno.models.response import ModelResponseEvent
from agno.run.messages import RunMessages
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

class PatchedTeam(Team):
    def write_to_storage(self, session_id: str, user_id: Optional[str] = None) -> Optional[Any]:
        logging.debug(f"Turn-by-turn write_to_storage for team session {session_id} is disabled by patch.")
        pass


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
    custom_tool_config: Optional[Dict[str, Any]] = None,
) -> Team:
    """
    Constructs the hierarchical Aetheria AI multi-agent system with integrated planner.
    """
    direct_tools: List[Toolkit] = []

    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set.")
    db_url_sqlalchemy = db_url_full.replace("postgresql://", "postgresql+psycopg2://")

    # --- CORRECTED: Instantiate a single, unified database handler ---
    # The PostgresDb class in agno v2 handles both session history and long-term memory.
    db = PostgresDb(
        db_url=db_url_sqlalchemy
    )
    # --- END CORRECTION ---

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


    @tool(show_result=False)
    def generate_image(prompt: str) -> str:
        logger.info(f"Initiating synchronous image generation with prompt: '{prompt}'")
        try:
            socketio = custom_tool_config.get('socketio') if custom_tool_config else None
            sid = custom_tool_config.get('sid') if custom_tool_config else None
            message_id = custom_tool_config.get('message_id') if custom_tool_config else None

            if not all([socketio, sid, message_id]):
                error_msg = "Cannot emit image: socketio, sid, or message_id missing from config."
                logger.error(error_msg)
                return f"Error: {error_msg}"

            artist_agent = Agent(
                name="artist_agent",
                model=Gemini(
                    id="gemini-2.0-flash-exp-image-generation",
                    response_modalities=["Text", "Image"],
                ),
                debug_mode=debug_mode,
            )

            artist_agent.run(prompt, stream=False)
            images = artist_agent.get_images()

            if not images:
                logger.warning("Artist agent ran but returned no images.")
                return "An image could not be generated for that prompt."

            image_response = images[0]
            if not image_response.content:
                logger.warning("Image response was found, but it has no content.")
                return "An image could not be generated for that prompt."

            artifact_id = f"image-artifact-{uuid.uuid4()}"
            image_bytes = image_response.content
            base64_image = base64.b64encode(image_bytes).decode('utf-8')

            socketio.emit("image_generated", {
                "id": message_id,
                "artifactId": artifact_id,
                "image_base64": base64_image,
                "agent_name": "artist_agent",
            }, room=sid)
            logger.info(f"Emitted 'image_generated' event for artifact {artifact_id}.")

            return f"I have generated an image for you.\n\n```image\n{artifact_id}\n```"

        except Exception as e:
            logger.error(f"Error in generate_image tool: {e}\n{traceback.format_exc()}")
            return "An unexpected error occurred while trying to generate the image."

    direct_tools.append(generate_image)

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
    available_resources["direct_tools"].append("generate_image - AI image generation")
    if enable_vercel:
        available_resources["direct_tools"].append("VercelTools - Vercel project and deployment operations")
    available_resources["direct_tools"].append("generate_image - AI image generation")
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
            model=Groq(id="deepseek-r1-distill-llama-70b"),
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
                "  Step 3: Generate visualization → generate_image → Create infographic",
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
            model=Gemini(id="gemini-2.5-flash"),
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
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
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

    aetheria_instructions = [
        "Aetheria AI: Most Advanced AI system in the world providing personalized, direct responses. Access context via session_state['turn_context'].",
        "", "COMPLEXITY ASSESSMENT - First determine:",
        "• Is this a simple, single-step query? → Handle directly",
        "• Is this a complex, multi-step task? → Delegate to planner first",
        "• Does it require multiple tools/agents? → Delegate to planner first",
        "", "WORKFLOW FOR COMPLEX TASKS:",
        "1. If query is complex or multi-step → Send to 'planner' agent",
        "2. Receive execution plan from planner",
        "3. Execute plan step-by-step using specified agents/tools",
        "4. Compile results and deliver final response",
        "", "ROUTING GUIDE FOR SIMPLE TASKS:",
        "• Coding/Terminal/Files/Testing → dev_team (has sandbox tools)",
        "• Web research/Data extraction → World_Agent",
        "• Image generation → generate_image",
        "• Browser interaction/Visual inspection → browser_tools, Start by using browser_tools.get_status() to ensure connection",
        "• Vercel project management (listing projects, deployments) → VercelTools",
        "• Simple searches → GoogleSearchTools",
        "• Supabase organization and project management -> SupabaseTools",
        "", "DECISION LOGIC:",
        "- Need to SEE and INTERACT with webpage → use browser_tools",
        "- Need to CODE/RUN commands → delegate to dev_team",
        "", "EXECUTION PRINCIPLES:",
        "• Follow planner's steps precisely when executing complex tasks",
        "• Maintain context between steps",
        "• If a step fails, adapt and continue or request new plan",
        "• Compile intermediate results for final synthesis",
        "", "RESPONSE STYLE:",
        "• Deliver results as if you personally completed the task",
        "• Use personalized responses when user data is available",
        "• Provide direct, clear answers without explaining internal processes",
        "• Don't use phrases like 'based on my knowledge', 'depending on information', 'I will now', etc.",
        "• Focus on user value, not system operations",
        "• Keep responses natural and conversational",
    ]

    llm_os_team = PatchedTeam(
        name="Aetheria_AI",
        model=Gemini(id="gemini-2.5-flash"),
        members=main_team_members,
        tools=direct_tools,
        instructions=aetheria_instructions,
        user_id=user_id,
        db=db,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        stream_intermediate_steps=True,
        search_knowledge=use_memory,
        read_team_history=True,
        add_history_to_context=True,
        num_history_runs=40,
        store_events=True,
        markdown=True,
        add_datetime_to_context=True,
        debug_mode=debug_mode,
    )

    return llm_os_team