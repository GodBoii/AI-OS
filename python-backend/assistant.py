import os 
from pathlib import Path
from textwrap import dedent
import logging

from typing import Optional, List, Any

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
from agno.tools.shell import ShellTools
from agno.tools.calculator import CalculatorTools
from agno.tools.googlesearch import GoogleSearchTools
from agno.tools.yfinance import YFinanceTools
from agno.tools.python import PythonTools
from agno.tools.crawl4ai import Crawl4aiTools
from agno.models.google import Gemini
from typing import List, Optional
from agno.memory.v2.db.postgres import PostgresMemoryDb
from agno.storage.postgres import PostgresStorage
from sandbox_tools import SandboxTools

    
def get_llm_os(
    user_id: Optional[str] = None,
    socketio_instance: Optional[Any] = None,
    calculator: bool = False,
    web_crawler: bool = False,
    internet_search: bool = False,
    shell_tools: bool = False,
    coding_assistant: bool = False,
    investment_assistant: bool = False,
    use_memory: bool = False, 
    debug_mode: bool = True,
    enable_github: bool = False,
    enable_google_email: bool = False,
    enable_google_drive: bool = False,
) -> Agent:
    tools: List[Toolkit] = []
    extra_instructions: List[str] = []

    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set. Please set it in Render.")
    
    # Both classes use SQLAlchemy, which needs the driver name in the URL.
    db_url_sqlalchemy = db_url_full.replace("postgresql://", "postgresql+psycopg2://")

    # Configure memory
    if use_memory:
    # 1. Create the database connector for long-term memory
        memory_db = PostgresMemoryDb(
            table_name="agent_memories",
            db_url=db_url_sqlalchemy,
            schema="public"  # <-- CRITICAL FIX: Tell agno to use the public schema
        )
        # 2. Create the V2 memory object
        memory = AgnoMemoryV2(db=memory_db)
        extra_instructions.append(
            "You have access to long-term memory. Use the `search_knowledge_base` tool to search your memory for relevant information."
        )
    else:
        memory = None

    
    if enable_github and user_id:
        try:
            response = supabase_client.from_("user_integrations") \
                .select("id", count='exact') \
                .eq("user_id", user_id) \
                .eq("service", "github") \
                .execute()
            
            if response.count > 0:
                tools.append(GitHubTools(user_id=user_id))
                extra_instructions.append(
                    "To interact with the user's GitHub account, such as listing repositories or creating issues, use the `GitHubTools`."
                )
                logger.info(f"GitHub tools enabled for user {user_id}.")
            else:
                logger.info(f"GitHub tools not enabled for user {user_id}: No integration found.")
        except Exception as e:
            # Use the standard logger, which can handle exception objects correctly.
            # exc_info=True will also log the full traceback for better debugging.
            logger.error(f"Could not check for GitHub integration for user {user_id}", exc_info=True)

    if (enable_google_email or enable_google_drive) and user_id:
        try:
            response = supabase_client.from_("user_integrations").select("id", count='exact').eq("user_id", user_id).eq("service", "google").execute()
            if response.count > 0:
                if enable_google_email:
                    tools.append(GoogleEmailTools(user_id=user_id))
                    extra_instructions.append("To read or send emails from the user's connected Gmail account, use the `GoogleEmailTools`.")
                    logger.info(f"Google Email tools enabled for user {user_id}.")
                if enable_google_drive:
                    tools.append(GoogleDriveTools(user_id=user_id))
                    extra_instructions.append("To interact with Google Drive, first use the `search_files` tool to find a file's ID, then use the `read_file_content` tool with that ID to get its contents.")
                    logger.info(f"Google Drive tools enabled for user {user_id}.")
            else:
                logger.info(f"Google tools not enabled for user {user_id}: No integration found.")
        except Exception as e:
            logger.error(f"Could not check for Google integration for user {user_id}", exc_info=True)



    if calculator:
        calc_tool = CalculatorTools(
            add=True,
            subtract=True,
            multiply=True,
            divide=True,
            exponentiate=True,
            factorial=True,
            is_prime=True,
            square_root=True,
        )
        tools.append(calc_tool)
        extra_instructions.append(
            "Use the Calculator tool for mathematical operations."
        )

    if internet_search:
        internet_tool = GoogleSearchTools(fixed_max_results=15)
        tools.append(internet_tool)
        extra_instructions.append(
            "Use the internet search tool to find current information from the internet. Always include sources at the end of your response."
        )

    team: List[Agent] = []
    if coding_assistant:
        _coding_assistant = Agent(
            name="Coding Assistant",
            tools=[SandboxTools()],
            role="Coding agent",
            instructions=["You have access to a stateful sandbox for code execution.",
                            "IMPORTANT: You MUST follow this three-step process for any shell command or code execution task:",
                            "1. **Create Session**: First, call the `create_sandbox()` tool. This will return a `sandbox_id`.",
                            "2. **Execute Commands**: Use the `execute_in_sandbox()` tool for ALL subsequent commands. You must pass the `sandbox_id` you received from step 1 with every call. You can call this multiple times to install packages, write files, and run code.",
                            "3. **Close Session**: Once the entire task is complete and you have the final result, you MUST call the `close_sandbox(sandbox_id)` tool to clean up the environment.",
                            "Never assume a sandbox exists. Always create one for a new task."
                        ],
            description="You can write and run code to fulfill users' requests",
            model=Gemini(id="gemini-2.5-flash"),
            debug_mode=debug_mode
        )
        team.append(_coding_assistant)
        extra_instructions.append("To execute a shell command, you MUST follow this two-step process: "
                                  "1. First, call the `prepare_sandbox_terminal()` tool to create a terminal window for the user. This tool will return a unique `artifactId`. "
                                  "2. Second, call the `execute_command_in_terminal()` tool, passing the command you want to run and the `artifactId` you received from the first step."
                                  "3. Finally, call the `close_sandbox_terminal()` tool to close the terminal window.")

    if web_crawler:
        _web_crawler = Agent(
            name="Web Crawler",
            role="Extract information from a given URL",
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "For a given URL, extract relevant information and summarize the content.",
                "Provide the user with the extracted information in a clear and concise manner.",
            ],
            tools=[Crawl4aiTools(max_length=None)],
            markdown=True,
            add_datetime_to_instructions=True,
            debug_mode=debug_mode,
        )
        team.append(_web_crawler)
        extra_instructions.extend([
            "To extract information from a URL, delegate the task to the `Web Crawler`.",
            "Provide the user with the extracted information in a clear and concise manner.",
        ])

    if investment_assistant:
        report_format = dedent("""\
        <report_format>
        ## [Company Name]: Investment Report

        ### **Overview**
        {give a brief introduction of the company and why the user should read this report}
        {make this section engaging and create a hook for the reader}

        ### Core Metrics
        {provide a summary of core metrics and show the latest data}
        - Current price: {current price}
        - 52-week high: {52-week high}
        - 52-week low: {52-week low}
        - Market Cap: {Market Cap} in billions
        - P/E Ratio: {P/E Ratio}
        - Earnings per Share: {EPS}
        - 50-day average: {50-day average}
        - 200-day average: {200-day average}
        - Analyst Recommendations: {buy, hold, sell} (number of analysts)

        ### Financial Performance
        {analyze the company's financial performance}

        ### Growth Prospects
        {analyze the company's growth prospects and future potential}

        ### News and Updates
        {summarize relevant news that can impact the stock price}

        ### [Summary]
        {give a summary of the report and what are the key takeaways}

        ### [Recommendation]
        {provide a recommendation on the stock along with a thorough reasoning}

        </report_format>
        """)
        
        _investment_assistant = Agent(
            name="Investment Assistant",
            role="Write investment reports on companies",
            model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
            instructions=[
                "For a given stock symbol, get the stock price, company information, analyst recommendations, and company news",
                "Carefully read the research and generate a final - Goldman Sachs worthy investment report in the report format provided.",
                "Provide thoughtful insights and recommendations based on the research.",
                "When you share numbers, make sure to include the units (e.g., millions/billions) and currency.",
                "REMEMBER: This report is for a very important client, so the quality of the report is important.",
                report_format
            ],
            tools=[YFinanceTools(stock_price=True, company_info=True, analyst_recommendations=True, company_news=True)],
            markdown=True,
            add_datetime_to_instructions=True,
            debug_mode=debug_mode,
        )
        team.append(_investment_assistant)
        extra_instructions.extend([
            "To get an investment report on a stock, delegate the task to the `Investment Assistant`. "
            "Return the report in the <report_format> to the user without any additional text like 'here is the report'.",
            "Answer any questions they may have using the information in the report.",
            "Never provide investment advise without the investment report.",
        ])

    # Create the main AI_OS agent
    llm_os = AIOS_PatchedAgent(
        user_id=user_id,
        name="Aetheria ai",
        model=Gemini(id="gemini-2.5-flash"),
        description=dedent("""\
        You are Aetheria ai, an advanced AI system designed to be a helpful and efficient assistant. You have access to a suite of 
        tools and a team of specialized AI Assistants. Your primary goal is to understand the user's needs and leverage your 
        resources to fulfill them effectively. You are proactive, resourceful, and prioritize providing accurate and relevant
        information.\
        """),
        instructions=[
            "**Prioritize using available tools to answer the user's query.**",
            "**Decision-Making Process (in order of priority):**",  
            "1. **Knowledge Base Search:** If the user asks about a specific topic, ALWAYS begin by searching your knowledge base using `search_knowledge_base` to see if relevant information is already available.",
            "2. **Direct Answer:** If the user's question can be answered directly based on your existing knowledge or after consulting the knowledge base, provide a clear and concise answer.",
            "3. **Internet Search:** If the knowledge base doesn't contain the answer, use `internet_search` to find current information on the internet.  **Always include sources at the end of your response.**",
            "4. **Tool Delegation:**  If a specific tool is required to fulfill the user's request (e.g., calculating a value, crawling a website, interacting with GitHub or Google Services), choose the appropriate tool and use it immediately.",
            "5. **Assistant Delegation:** If a task is best handled by a specialized AI Assistant (e.g., creating an investment report, writing and running python code), delegate the task to the appropriate assistant and relay their response to the user.",
            "6. **Clarification:** If the user's message is unclear or ambiguous, ask clarifying questions to obtain the necessary information before proceeding. **Do not make assumptions.**",
            "**Tool Usage Guidelines:**",
            "   - For mathematical calculations, use the `Calculator` tool if precision is required.",
            "   - For up-to-date information, use the `internet_search` tool.  **Always include sources URL's at the end of your response.**",
            "   - When the user provides a URL, IMMEDIATELY use the `Web Crawler` tool without any preliminary message.",
            "   - Delegate investment report requests to the `Investment Assistant`.",
            "   - **GitHub:** To interact with GitHub, use a combination of tools. To see available repos, use `list_repositories`. To read a file, use `get_file_content`. To see open pull requests, use `list_pull_requests`. To understand a specific PR, use `get_pull_request_details` with its number. To create an issue, use `create_issue`. To comment on an issue or PR, use `add_comment`.",
            "   - **Gmail:** To manage emails, use `search_emails` with a query (e.g., 'from:boss is:unread') to find messages. Use `read_latest_emails` for a quick overview. Use `reply_to_email` with a message ID to respond to a thread. Use `modify_email` to archive (remove 'INBOX' label) or label emails.",
            "   - **Google Drive:** To manage files, use `search_files` to find a file and get its ID. Use `read_file_content` with that ID to read it. Use `create_file` to make new documents. Use `share_file` to grant permissions to others.",
            "   - **General Tools:** Use `Calculator` for math, `internet_search` for current events, `ShellTools` for local file system tasks.",
            "**Response Guidelines:**",
            "   - Avoid phrases like 'based on my knowledge' or 'depending on the information' or 'based on our previous conversation'.or 'based on past interactions'" ,
            "   - Do not explain your reasoning or the steps you are taking unless the user specifically asks for it.", 
            "**Memory Usage:**",
            "   - The `get_chat_history` tool should be used if the user explicitly asks you to summarize or reference your conversation.",
            "**Important Notes:**",
            "   - You have access to long-term memory. Use the `search_knowledge_base` tool to search your memory for relevant information.",
            "   - Do not explain what you're going to do - just use the appropriate tool or delegate the task right away.",
        ] + extra_instructions,
        
        # Add long-term memory to the LLM OS backed by JSON file storage
        storage=PostgresStorage(
            table_name="ai_os_sessions",
            db_url=db_url_sqlalchemy,
            schema="public",
            auto_upgrade_schema=True # Let agno manage this table's schema
        ),
        memory=memory,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        stream_intermediate_steps=True,
        # Add selected tools to the LLM OS
        tools=tools,
        # Add selected team members to the LLM OS
        team=team,
        # Show tool calls in the chat
        show_tool_calls=False,
        # This setting gives the LLM a tool to search the knowledge base for information
        search_knowledge=use_memory,
        # This setting gives the LLM a tool to get chat history
        read_chat_history=True,
        # This setting adds chat history to the messages
        add_history_to_messages=True,
        num_history_responses=60,
        # This setting tells the LLM to format messages in markdown
        markdown=True,
        # This setting adds the current datetime to the instructions
        add_datetime_to_instructions=True,
        introduction=dedent("""\
        Hi, I'm your Aetheria ai.
        I have access to a set of tools and AI Assistants to assist you.
        Let's solve some problems together!\
        """),
        debug_mode=debug_mode,
    )
    return llm_os