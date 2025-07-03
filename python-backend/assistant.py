import os 
from pathlib import Path
from textwrap import dedent
import logging

from typing import Optional, List, Dict, Any, Set

from agno.agent import Agent, AgentSession
from agno.utils.log import log_debug
from agno.memory.v2.memory import Memory as AgnoMemoryV2

from github_tools import GitHubTools
from google_email_tools import GoogleEmailTools
from google_drive_tools import GoogleDriveTools
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

class AIOS_PatchedAgent(Agent):
    def write_to_storage(self, session_id: str, user_id: Optional[str] = None) -> Optional[AgentSession]:
        log_debug(f"Turn-by-turn write_to_storage for session {session_id} is disabled by patch.")
        pass
        
from agno.tools import Toolkit
from agno.tools.calculator import CalculatorTools
from agno.tools.googlesearch import GoogleSearchTools
from agno.tools.yfinance import YFinanceTools
from agno.tools.crawl4ai import Crawl4aiTools
from agno.models.google import Gemini
from typing import List, Optional
from agno.memory.v2.db.postgres import PostgresMemoryDb
from agno.storage.postgres import PostgresStorage
from sandbox_tools import SandboxTools

    
def get_llm_os(
    user_id: Optional[str] = None,
    sandbox_tracker_set: Optional[Set[str]] = None,
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
) -> Agent:
    tools: List[Toolkit] = []
    instructions = []

    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set. Please set it in Render.")
    
    db_url_sqlalchemy = db_url_full.replace("postgresql://", "postgresql+psycopg2://")

    # Memory setup
    if use_memory:
        memory_db = PostgresMemoryDb(
            table_name="agent_memories",
            db_url=db_url_sqlalchemy,
            schema="public"
        )
        memory = AgnoMemoryV2(db=memory_db)
    else:
        memory = None

    # Tool integrations
    if enable_github and user_id:
        try:
            response = supabase_client.from_("user_integrations") \
                .select("id", count='exact') \
                .eq("user_id", user_id) \
                .eq("service", "github") \
                .execute()
            
            if response.count > 0:
                tools.append(GitHubTools(user_id=user_id))
                logger.info(f"GitHub tools enabled for user {user_id}.")
        except Exception as e:
            logger.error(f"Could not check for GitHub integration for user {user_id}", exc_info=True)

    if (enable_google_email or enable_google_drive) and user_id:
        try:
            response = supabase_client.from_("user_integrations").select("id", count='exact').eq("user_id", user_id).eq("service", "google").execute()
            if response.count > 0:
                if enable_google_email:
                    tools.append(GoogleEmailTools(user_id=user_id))
                    logger.info(f"Google Email tools enabled for user {user_id}.")
                if enable_google_drive:
                    tools.append(GoogleDriveTools(user_id=user_id))
                    logger.info(f"Google Drive tools enabled for user {user_id}.")
        except Exception as e:
            logger.error(f"Could not check for Google integration for user {user_id}", exc_info=True)

    if calculator:
        tools.append(CalculatorTools(
            add=True, subtract=True, multiply=True, divide=True,
            exponentiate=True, factorial=True, is_prime=True, square_root=True,
        ))

    if internet_search:
        tools.append(GoogleSearchTools(fixed_max_results=15))

    # Team agents
    team: List[Agent] = []
    
    if coding_assistant:
        sandbox_tools = SandboxTools(session_info=session_info) if session_info else None
        team.append(Agent(
            name="Coder",
            tools=[sandbox_tools] if sandbox_tools else [],
            role="Execute code & shell commands",
            instructions=[
                "1. Call create_or_get_sandbox() first to get sandbox_id",
                "2. Use execute_in_sandbox() with the sandbox_id for all commands"
            ],
            model=Gemini(id="gemini-2.5-flash"),
            debug_mode=debug_mode
        ))

    if web_crawler:
        team.append(Agent(
            name="Crawler",
            role="Extract web content",
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=["Extract and summarize content from URLs"],
            tools=[Crawl4aiTools(max_length=None)],
            markdown=True,
            debug_mode=debug_mode,
        ))

    if investment_assistant:
        team.append(Agent(
            name="Investor",
            role="Generate investment reports",
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "Create professional investment reports with:",
                "Overview, Core Metrics, Financial Performance, Growth Prospects, News, Summary, Recommendation"
            ],
            tools=[YFinanceTools(stock_price=True, company_info=True, analyst_recommendations=True, company_news=True)],
            markdown=True,
            debug_mode=debug_mode,
        ))

    # Optimized core instructions
    core_instructions = [
        "You are Aetheria AI - an efficient assistant with specialized tools and agents.",
        "PRIORITY ORDER:",
        "1. Search knowledge base first if available",
        "2. Answer directly from knowledge", 
        "3. Use internet search for current info (cite sources)",
        "4. Use appropriate tools/agents for specific tasks",
        "5. Ask for clarification if unclear",
        "TOOL RULES:",
        "- Calculator: math operations",
        "- Internet search: always cite sources",
        "- Web Crawler: immediate URL processing", 
        "- Coder: delegate all code/shell tasks",
        "- Investor: delegate investment reports",
        "- GitHub: list_repositories, get_file_content, create_issue",
        "- Gmail: search_emails, read_latest_emails, reply_to_email",
        "- Drive: search_files, read_file_content, create_file",
        "Don't explain actions - just execute them."
    ]

    # Add conditional instructions only when tools are enabled
    if use_memory:
        core_instructions.insert(1, "Search knowledge base with search_knowledge_base tool.")
    if calculator:
        core_instructions.append("Use Calculator for precise math.")
    if internet_search:
        core_instructions.append("Include source URLs for web searches.")
    if coding_assistant:
        core_instructions.append("Delegate code/terminal tasks to Coder.")
    if web_crawler:
        core_instructions.append("Process URLs immediately with Crawler.")
    if investment_assistant:
        core_instructions.append("Delegate investment analysis to Investor.")

    # Create optimized main agent
    llm_os = AIOS_PatchedAgent(
        user_id=user_id,
        name="Aetheria AI",
        model=Gemini(id="gemini-2.5-flash"),
        description="Advanced AI assistant with specialized tools and agents.",
        instructions=core_instructions,
        
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
        tools=tools,
        team=team,
        show_tool_calls=False,
        search_knowledge=use_memory,
        read_chat_history=True,
        add_history_to_messages=True,
        num_history_responses=40,  # Reduced from 60
        markdown=True,
        add_datetime_to_instructions=True,
        introduction="Hi! I'm Aetheria AI. I have tools and agents to help you. What can I do for you?",
        debug_mode=debug_mode,
    )
    return llm_os