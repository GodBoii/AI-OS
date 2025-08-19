import os
import logging
from typing import Optional, List, Dict, Any, Set, Union, Iterator

# Agno Core Imports
from agno.agent import Agent
from agno.team import Team  # Import the Team class
from agno.media import Image

from agno.run.team import TeamRunResponseEvent
from agno.models.response import ModelResponseEvent
from agno.run.messages import RunMessages


from agno.memory.v2.memory import Memory as AgnoMemoryV2
from agno.storage.postgres import PostgresStorage
from agno.memory.v2.db.postgres import PostgresMemoryDb
from agno.models.google import Gemini

# Tool Imports
from agno.tools import Toolkit
from agno.tools.calculator import CalculatorTools
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
    web_crawler: bool = False,
    internet_search: bool = False,
    coding_assistant: bool = False,
    investment_assistant: bool = False,
    use_memory: bool = False,
    debug_mode: bool = True,
    enable_github: bool = False,
    enable_google_email: bool = False,
    enable_google_drive: bool = False,
    enable_browser: bool = False,  # <-- NEW: Flag to enable browser tools
    browser_tools_config: Optional[Dict[str, Any]] = None,
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
    if internet_search:
        direct_tools.append(GoogleSearchTools(fixed_max_results=15))
    if enable_browser and browser_tools_config:
        logger.info("Browser tools are enabled and configured. Initializing BrowserTools.")
        direct_tools.append(BrowserTools(**browser_tools_config))


    # --- 3. SPECIALIST AGENT AND TEAM DEFINITIONS ---
    main_team_members: List[Union[Agent, Team]] = []

    # --- 3.1. The Development Team (unified planner + executor) ---
    if coding_assistant:
        dev_team = Team(
            name="dev_team",
            mode="coordinate",
            model=Gemini(id="gemini-2.5-flash"),
            members=[],
            tools=[SandboxTools(session_info=session_info)] if session_info else [],
            instructions=[
                "Development team: Plan and execute code solutions using sandbox tools.",
                "Access files from team_session_state['turn_context']['files'].",
                "Workflow: 1) Analyze requirements 2) Plan solution 3) Implement code 4) Test & verify.",
                "Use sandbox tools for file operations, code execution, terminal commands, testing.",
                "Output: Brief summary + working code + test results.",
                "Keep responses focused and under 300 words unless complex implementation needed."
            ],
            debug_mode=debug_mode
        )
        main_team_members.append(dev_team)

    # --- 3.2. Other Specialist Agents ---
    if web_crawler:
        crawler_agent = Agent(
            name="Crawler",
            role="Web content extractor providing structured summaries from URLs.",
            tools=[Crawl4aiTools(max_length=None)],
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "Check team_session_state['turn_context'] for URLs and context.",
                "Use website scraping functions to extract detailed content from URLs.",
                "Focus on comprehensive content extraction including text, links, and structure.",
                "Handle complex websites with dynamic content and multiple pages.",
                "Provide structured output with clear source attribution."
            ],
            markdown=True,
            debug_mode=debug_mode,
        )

        deep_crawler_agent = Agent(
            name="Deep_Crawler",
            role="Deep web content extractor providing structured summaries from URLs.",
            tools=[WebsiteTools()],
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "Check team_session_state['turn_context'] for URLs and context.",
                "Use website scraping functions to extract detailed content from URLs.",
                "Focus on comprehensive content extraction including text, links, and structure.",
                "Handle complex websites with dynamic content and multiple pages.",
                "Provide structured output with clear source attribution."
            ],
            markdown=True,
            debug_mode=debug_mode,
        )

        Arxiv_agent = Agent(
            name="Arxiv_Agent",
            role="authors publications and research papers information extractor",
            tools=[ArxivTools()],
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "Use team_session_state['turn_context'] for search context.",
                "Use ArXiv functions to search and retrieve academic papers.",
                "Extract paper metadata: title, authors, abstract, publication date, categories.",
                "Focus on research papers, preprints, and scholarly publications.",
                "Provide structured academic content with citation information."
            ],
            markdown=True,
            debug_mode=debug_mode,
        )

        hacker_news_agent = Agent(
            name="Hacker News Agent",
            role="HackerNews enables an Agent to search Hacker News website.",
            tools=[HackerNewsTools()],
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "Use team_session_state['turn_context'] for search context.",
                "Use get_top_hackernews_stories to fetch trending tech stories (default 10, specify num_stories).",
                "Use get_user_details to retrieve HN user profiles by username.",
                "Extract story titles, scores, comments, and user engagement metrics.",
                "Focus on tech trends, startup news, and community discussions."
            ],
            markdown=True,
            debug_mode=debug_mode,
        )

        wikipedia_agent = Agent(
            name="Wikipedia Agent",
            role="Wikipedia enables an Agent to search Wikipedia website.",
            tools=[WikipediaTools()],
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "Use team_session_state['turn_context'] for search context.",
                "Use Wikipedia functions to search and retrieve encyclopedic content.",
                "Extract article content, summaries, and structured information.",
                "Focus on factual, well-sourced information with citations.",
                "Provide comprehensive background knowledge and definitions."
            ],
            markdown=True,
            debug_mode=debug_mode,
        )

        research_team = Team(
            name="Research_Team",
            mode="coordinate",
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            members=[wikipedia_agent, hacker_news_agent, Arxiv_agent, deep_crawler_agent, crawler_agent],
            instructions=[
                "Research coordinator: Route queries to appropriate specialist agents based on content type.",
                "Access team_session_state['turn_context'] for full context.",
                "Routing strategy: Wikipedia (encyclopedic) → ArXiv (academic) → HackerNews (tech stories) → Deep Crawler (deep url scraping)→ Crawler (general url scraping).",
                "HackerNews agent: Use get_top_hackernews_stories for trending tech, get_user_details for profiles.",
                "Synthesize findings from multiple sources, note conflicts, verify information.",
                "Ensure members use shared context. Synthesize with source attribution."
                "use multiple agents if you think it is necessary"
            ],
            debug_mode=debug_mode,
        )
        main_team_members.append(research_team)

    if investment_assistant:
        investor_agent = Agent(
            name="Investor",
            role="Generate professional investment reports.",
            tools=[YFinanceTools(stock_price=True, company_info=True, analyst_recommendations=True, company_news=True)],
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "Use team_session_state['turn_context'] for stock symbols and context.",
                "Create professional investment reports with:",
                "Overview, Core Metrics, Financial Performance, Growth Prospects, News, Summary, Recommendation"
            ],
            markdown=True,
            debug_mode=debug_mode,
        )
        main_team_members.append(investor_agent)

    # --- 4. TOP-LEVEL TEAM (AETHERIA AI) CONFIGURATION ---
    aetheria_instructions = [
        "Aetheria AI: Most Advanced AI system in the world providing personalized, direct responses. Access context via team_session_state['turn_context'].",
        "",
        "THINKING PROCESS - First determine:",
        "• Can I answer using available direct tools?",
        "• Do I need to search knowledge base/memory?", 
        "• Do I need to search internet?",
        "• Do I need to delegate to specialists?",
        "• Do I need clarification from user?",
        "",
        "ROUTING GUIDE:",
        "• Coding/Terminal/Files/Testing → dev_team (has sandbox tools)",
        "• Web research/Data extraction → Research_Team (Wikipedia, ArXiv, HackerNews, web crawling)",
        "• Stock/Finance analysis → Investor (YFinance tools)",
        "• Browser interaction/Visual inspection → browser_tools, Start by using browser_tools.get_status() to ensure connection",
        "• Simple searches → GoogleSearch (direct tool)",
        "",
        "DECISION LOGIC:",
        "- Need to SEE and INTERACT with webpage → use browser_tools",
        "- Need to EXTRACT data from webpage → delegate to Research_Team", 
        "- Need to CODE/RUN commands → delegate to dev_team",
        "- Need FINANCIAL data → delegate to Investor",
        "",
        "RESPONSE STYLE:",
        "• Use personalized responses when user data is available",
        "• Provide direct, clear answers without explaining internal processes",
        "• Don't use phrases like 'based on my knowledge', 'depending on information', 'I will now', etc.",
        "• Focus on user value, not system operations",
        "• Keep responses natural and conversational",
        "",
        "Always inform teams to use shared context. Deliver final results as if you personally completed the task."
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