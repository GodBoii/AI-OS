import os
import logging
from typing import Optional, List, Dict, Any, Set, Union

# Agno Core Imports
from agno.agent import Agent
from agno.team import Team  # Import the Team class
from agno.memory.v2.memory import Memory as AgnoMemoryV2
from agno.storage.postgres import PostgresStorage
from agno.memory.v2.db.postgres import PostgresMemoryDb
from agno.models.google import Gemini

# Tool Imports
from agno.tools import Toolkit
from agno.tools.calculator import CalculatorTools
from agno.tools.googlesearch import GoogleSearchTools
from agno.tools.yfinance import YFinanceTools
from agno.tools.crawl4ai import Crawl4aiTools
from sandbox_tools import SandboxTools
from github_tools import GitHubTools
from google_email_tools import GoogleEmailTools
from google_drive_tools import GoogleDriveTools

# Other Imports
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

# To preserve the custom behavior of not writing to storage on every turn,
# we create a patched Team class, just as you did for the Agent.
class PatchedTeam(Team):
    def write_to_storage(self, session_id: str, user_id: Optional[str] = None) -> Optional[Any]:
        logging.debug(f"Turn-by-turn write_to_storage for team session {session_id} is disabled by patch.")
        pass

def get_llm_os(
    user_id: Optional[str] = None,
    session_info: Optional[Dict[str, Any]] = None,
    calculator: bool = False,
    web_crawler: bool = False,
    internet_search: bool = False,
    coding_assistant: bool = False,
    investment_assistant: bool = False,
    use_memory: bool = False,
    debug_mode: bool = True,
    enable_github: bool = False,
    enable_google_email: bool = False,
    enable_google_drive: bool = False,
) -> Team:  # The factory now returns a Team instance
    """
    Constructs the hierarchical Aetheria AI multi-agent system.
    """
    # --- 1. CORE INFRASTRUCTURE SETUP (Unchanged) ---
    direct_tools: List[Toolkit] = []

    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set.")
    db_url_sqlalchemy = db_url_full.replace("postgresql://", "postgresql+psycopg2://")

    if use_memory:
        memory_db = PostgresMemoryDb(table_name="agent_memories", db_url=db_url_sqlalchemy, schema="public")
        memory = AgnoMemoryV2(db=memory_db)
    else:
        memory = None

    # --- 2. DIRECT TOOL INTEGRATIONS (Unchanged) ---
    # These tools will be used by the top-level coordinator.
    if enable_github and user_id:
        # ... (github integration logic remains the same)
        direct_tools.append(GitHubTools(user_id=user_id))
    if (enable_google_email or enable_google_drive) and user_id:
        # ... (google integration logic remains the same)
        if enable_google_email:
            direct_tools.append(GoogleEmailTools(user_id=user_id))
        if enable_google_drive:
            direct_tools.append(GoogleDriveTools(user_id=user_id))
    if calculator:
        direct_tools.append(CalculatorTools(add=True, subtract=True, multiply=True, divide=True, exponentiate=True, factorial=True, is_prime=True, square_root=True))
    if internet_search:
        direct_tools.append(GoogleSearchTools(fixed_max_results=15))

    # --- 3. SPECIALIST AGENT AND TEAM DEFINITIONS ---
    main_team_members: List[Union[Agent, Team]] = []

    # --- 3.1. The Development Sub-Team (dev_team) ---
    if coding_assistant:
        # The Planner Agent (Designs the solution)
        code_planner = Agent(
            name="Code_Planner",
            role="You are an expert software architect. Your job is to create clear, step-by-step plans and pseudocode for development tasks. You do not write the final code.",
            model=Gemini(id="gemini-2.5-flash"),
            debug_mode=debug_mode
        )

        # The Executor Agent (Writes the code based on the plan)
        code_executor = Agent(
            name="Code_Executor",
            role="You are a diligent coder. You take a plan and turn it into functional code using the provided sandbox tools. You do not deviate from the plan.",
            tools=[SandboxTools(session_info=session_info)] if session_info else [],
            model=Gemini(id="gemini-2.5-flash"),
            debug_mode=debug_mode
        )

        # The Reviewer Agent (Checks the code for quality)
        code_reviewer = Agent(
            name="Code_Reviewer",
            role="You are a meticulous code reviewer. Your job is to analyze code for errors, style, and adherence to the original plan. You provide feedback and suggest improvements.",
            model=Gemini(id="gemini-2.5-flash"),
            debug_mode=debug_mode
        )

        # The Development Team Coordinator
        dev_team = Team(
            name="dev_team",
            mode="coordinate",  # Ensures a sequential Plan -> Execute -> Review workflow
            model=Gemini(id="gemini-2.5-flash"),  # A stronger model for coordination
            members=[code_planner, code_executor, code_reviewer],
            instructions=[
                "You are the lead of a software development team.",
                "First, delegate the task to the Code_Planner to get a solid plan.",
                "Second, pass the plan to the Code_Executor to write the code.",
                "Finally, pass the resulting code to the Code_Reviewer for quality assurance.",
                "Synthesize all steps into a final report detailing the outcome."
            ],
            debug_mode=debug_mode
        )
        main_team_members.append(dev_team)

    # --- 3.2. Other Specialist Agents ---
    if web_crawler:
        crawler_agent = Agent(
            name="Crawler",
            role="Extract and summarize web content from URLs.",
            tools=[Crawl4aiTools(max_length=None)],
            model=Gemini(id="gemini-2.5-flash"),
            markdown=True,
            debug_mode=debug_mode,
        )
        main_team_members.append(crawler_agent)

    if investment_assistant:
        investor_agent = Agent(
            name="Investor",
            role="Generate professional investment reports.",
            tools=[YFinanceTools(stock_price=True, company_info=True, analyst_recommendations=True, company_news=True)],
            model=Gemini(id="gemini-2.5-flash"),
            instructions=[
                "Create professional investment reports with:",
                "Overview, Core Metrics, Financial Performance, Growth Prospects, News, Summary, Recommendation"
            ],
            markdown=True,
            debug_mode=debug_mode,
        )
        main_team_members.append(investor_agent)

    # --- 4. TOP-LEVEL TEAM (AETHERIA AI) CONFIGURATION ---
    aetheria_instructions = [
        "You are Aetheria AI, a master project coordinator for a team of specialists.",
        "Your primary role is to analyze the user's request and delegate the high-level goal to the appropriate specialist team or agent.",
        " - For any software development, coding, or scripting tasks, delegate the entire goal to the 'dev_team'.",
        " - For web crawling and content extraction, delegate to the 'Crawler'.",
        " - For financial analysis and investment reports, delegate to the 'Investor'.",
        "If a task is simple and does not require a specialist, use your own tools (like Calculator or Internet Search) to answer directly.",
        "After a specialist or team completes a task, synthesize their report into a clear and final answer for the user."
    ]

    # The main orchestrator is now a PatchedTeam instance
    llm_os_team = PatchedTeam(
        name="Aetheria_AI",
        model=Gemini(id="gemini-2.5-flash"),  # A powerful model for top-level coordination
        members=main_team_members,
        mode="coordinate",
        
        # The coordinator has its own set of general-purpose tools
        tools=direct_tools,
        instructions=aetheria_instructions,
        
        # Pass all the original framework parameters
        user_id=user_id,
        storage=PostgresStorage(
            table_name="ai_os_sessions",
            db_url=db_url_sqlalchemy,
            schema="public",
            auto_upgrade_schema=True
        ),
        memory=memory,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        stream_intermediate_steps=True,
        show_tool_calls=False,
        search_knowledge=use_memory,
        read_team_history=True, # Use read_team_history for teams
        add_history_to_messages=True,
        num_history_runs=40,
        markdown=True,
        add_datetime_to_instructions=True,
        debug_mode=debug_mode,
    )

    return llm_os_team