import os 
from pathlib import Path
from textwrap import dedent
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any, Set, Literal

from pydantic import BaseModel, Field

from agno.agent import Agent, AgentSession
from agno.team import Team
from agno.utils.log import log_debug
from agno.memory.v2.memory import Memory as AgnoMemoryV2
from agno.tools import Toolkit
from agno.tools.calculator import CalculatorTools
from agno.tools.googlesearch import GoogleSearchTools
from agno.tools.yfinance import YFinanceTools
from agno.tools.crawl4ai import Crawl4aiTools
from agno.tools.arxiv import ArxivTools
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.models.google import Gemini
from agno.memory.v2.db.postgres import PostgresMemoryDb
from agno.storage.postgres import PostgresStorage

from github_tools import GitHubTools
from google_email_tools import GoogleEmailTools
from google_drive_tools import GoogleDriveTools
from supabase_client import supabase_client
from sandbox_tools import SandboxTools

logger = logging.getLogger(__name__)

# Structured Output Models
class TaskAnalysis(BaseModel):
    task_type: Literal["coding", "research", "investment", "integration", "general"]
    complexity: Literal["simple", "medium", "complex"]
    required_agents: List[str]
    estimated_steps: int
    priority: Literal["low", "medium", "high"]

class AgentResult(BaseModel):
    agent_name: str
    result: str
    confidence: float = Field(ge=0.0, le=1.0)
    metadata: Dict[str, Any] = Field(default_factory=dict)

class AetheriaResponse(BaseModel):
    task_analysis: TaskAnalysis
    primary_response: str
    agent_results: List[AgentResult] = Field(default_factory=list)
    supporting_data: Optional[Dict[str, Any]] = None
    recommendations: List[str] = Field(default_factory=list)
    confidence_score: float = Field(ge=0.0, le=1.0)
    execution_summary: str = ""

class AIOS_PatchedAgent(Agent):
    def write_to_storage(self, session_id: str, user_id: Optional[str] = None) -> Optional[AgentSession]:
        log_debug(f"Turn-by-turn write_to_storage for session {session_id} is disabled by patch.")
        pass

class AIOS_PatchedTeam(Team):
    def write_to_storage(self, session_id: str, user_id: Optional[str] = None) -> Optional[AgentSession]:
        log_debug(f"Turn-by-turn write_to_storage for session {session_id} is disabled by patch.")
        pass

# Team-Level Memory Tools
def update_team_memory(team: Team, key: str, value: str, category: str = "general") -> str:
    """Update team's shared memory with categorized information"""
    if "team_memory" not in team.team_session_state:
        team.team_session_state["team_memory"] = {}
    
    if category not in team.team_session_state["team_memory"]:
        team.team_session_state["team_memory"][category] = {}
    
    team.team_session_state["team_memory"][category][key] = {
        "value": value,
        "timestamp": datetime.now().isoformat(),
        "category": category
    }
    return f"Updated team memory [{category}]: {key}"

def retrieve_team_memory(team: Team, key: str, category: str = "general") -> str:
    """Retrieve from team's shared memory"""
    memory = team.team_session_state.get("team_memory", {})
    category_memory = memory.get(category, {})
    
    if key in category_memory:
        return f"Retrieved: {category_memory[key]['value']}"
    else:
        return f"No data found for key '{key}' in category '{category}'"

def list_team_memory(team: Team, category: Optional[str] = None) -> str:
    """List all items in team memory, optionally filtered by category"""
    memory = team.team_session_state.get("team_memory", {})
    
    if category:
        if category in memory:
            items = list(memory[category].keys())
            return f"Memory items in '{category}': {items}"
        else:
            return f"No items found in category '{category}'"
    else:
        all_items = []
        for cat, items in memory.items():
            all_items.extend([f"{cat}: {list(items.keys())}" for cat in memory])
        return f"All memory items: {all_items}"

def update_shared_context(team: Team, context_type: str, data: Dict[str, Any]) -> str:
    """Update shared context that all agents can access"""
    if "shared_context" not in team.team_session_state:
        team.team_session_state["shared_context"] = {}
    
    team.team_session_state["shared_context"][context_type] = {
        "data": data,
        "timestamp": datetime.now().isoformat(),
        "updated_by": "system"
    }
    return f"Updated shared context: {context_type}"

def get_shared_context(team: Team, context_type: Optional[str] = None) -> str:
    """Get shared context information"""
    context = team.team_session_state.get("shared_context", {})
    
    if context_type:
        if context_type in context:
            return f"Context [{context_type}]: {context[context_type]['data']}"
        else:
            return f"No context found for type '{context_type}'"
    else:
        return f"Available context types: {list(context.keys())}"

# Enhanced Tool Functions with Shared State
def execute_code_with_context(agent: Agent, code: str, language: str = "python") -> str:
    """Execute code with shared context awareness"""
    # Access shared findings from other agents
    shared_context = agent.team_session_state.get("shared_context", {})
    
    # Create context-aware execution
    context_info = ""
    if shared_context:
        context_info = f"Available context: {list(shared_context.keys())}\n"
    
    # Use the sandbox tools for execution
    sandbox_tools = SandboxTools()
    result = sandbox_tools.execute_in_sandbox(code, language)
    
    # Update shared context with results
    if "coding_results" not in agent.team_session_state:
        agent.team_session_state["coding_results"] = []
    
    agent.team_session_state["coding_results"].append({
        "code": code,
        "result": result,
        "language": language,
        "timestamp": datetime.now().isoformat()
    })
    
    return f"{context_info}Execution result:\n{result}"

def create_research_team(user_id: Optional[str] = None, debug_mode: bool = True) -> Team:
    """Create a collaborative research team"""
    
    web_researcher = Agent(
        name="Web_Researcher",
        role="Research current web information",
        model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
        tools=[GoogleSearchTools(fixed_max_results=10)],
        instructions=[
            "Search for current, relevant web information",
            "Focus on credible sources and recent content",
            "Summarize key findings clearly"
        ],
        debug_mode=debug_mode
    )
    
    academic_researcher = Agent(
        name="Academic_Researcher", 
        role="Research academic papers and scholarly content",
        model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
        tools=[ArxivTools(), GoogleSearchTools(fixed_max_results=5)],
        instructions=[
            "Find relevant academic papers and scholarly articles",
            "Focus on peer-reviewed content and citations",
            "Provide summaries of key findings and methodologies"
        ],
        debug_mode=debug_mode
    )
    
    content_analyzer = Agent(
        name="Content_Analyzer",
        role="Analyze and extract content from URLs",
        model=Gemini(id="gemini-2.5-flash-lite-preview-06-17"),
        tools=[Crawl4aiTools(max_length=None)],
        instructions=[
            "Extract and analyze content from provided URLs",
            "Summarize key information and insights",
            "Identify relevant data points and trends"
        ],
        debug_mode=debug_mode
    )
    
    research_team = AIOS_PatchedTeam(
        name="Research Team",
        mode="collaborate",
        model=Gemini(id="gemini-2.5-flash"),
        members=[web_researcher, academic_researcher, content_analyzer],
        instructions=[
            "Collaborate to provide comprehensive research on the given topic",
            "Each researcher should contribute their specialized perspective",
            "Synthesize findings into a cohesive research summary"
        ],
        enable_agentic_context=True,
        share_member_interactions=True,
        show_members_responses=True,
        markdown=True,
        debug_mode=debug_mode
    )
    
    return research_team

def create_development_team(session_info: Optional[Dict[str, Any]] = None, debug_mode: bool = True) -> Team:
    """Create a coordinated development team"""
    
    code_planner = Agent(
        name="Code_Planner",
        role="Plan and architect code solutions",
        model=Gemini(id="gemini-2.5-flash"),
        instructions=[
            "Analyze coding requirements and create implementation plans",
            "Break down complex tasks into manageable steps",
            "Provide architectural guidance and best practices"
        ],
        debug_mode=debug_mode
    )
    
    sandbox_tools = SandboxTools(session_info=session_info) if session_info else SandboxTools()
    code_executor = Agent(
        name="Code_Executor",
        role="Execute code and shell commands",
        model=Gemini(id="gemini-2.5-flash"),
        tools=[sandbox_tools],
        instructions=[
            "Execute code based on the planner's specifications",
            "Handle errors and provide debugging information",
            "Test and validate code functionality"
        ],
        debug_mode=debug_mode
    )
    
    code_reviewer = Agent(
        name="Code_Reviewer",
        role="Review and optimize code solutions",
        model=Gemini(id="gemini-2.5-flash"),
        instructions=[
            "Review executed code for quality and efficiency",
            "Suggest improvements and optimizations",
            "Ensure code follows best practices"
        ],
        debug_mode=debug_mode
    )
    
    dev_team = AIOS_PatchedTeam(
        name="Development Team",
        mode="coordinate",
        model=Gemini(id="gemini-2.5-flash"),
        members=[code_planner, code_executor, code_reviewer],
        instructions=[
            "Coordinate to plan, execute, and review code solutions",
            "Planner creates the approach, Executor implements, Reviewer validates",
            "Work together to deliver high-quality code solutions"
        ],
        enable_agentic_context=True,
        share_member_interactions=True,
        show_members_responses=True,
        markdown=True,
        debug_mode=debug_mode
    )
    
    return dev_team

def create_integration_team(user_id: Optional[str] = None, debug_mode: bool = True) -> Team:
    """Create a team for handling service integrations"""
    
    integration_agents = []
    
    # GitHub Integration Agent
    if user_id:
        try:
            response = supabase_client.from_("user_integrations") \
                .select("id", count='exact') \
                .eq("user_id", user_id) \
                .eq("service", "github") \
                .execute()
            
            if response.count > 0:
                github_agent = Agent(
                    name="GitHub_Specialist",
                    role="Handle GitHub operations",
                    model=Gemini(id="gemini-2.5-flash"),
                    tools=[GitHubTools(user_id=user_id)],
                    instructions=[
                        "Handle GitHub repository operations",
                        "Manage issues, pull requests, and file operations",
                        "Provide repository insights and management"
                    ],
                    debug_mode=debug_mode
                )
                integration_agents.append(github_agent)
        except Exception as e:
            logger.error(f"Could not setup GitHub integration: {e}")
    
    # Google Integration Agent
    if user_id:
        try:
            response = supabase_client.from_("user_integrations") \
                .select("id", count='exact') \
                .eq("user_id", user_id) \
                .eq("service", "google") \
                .execute()
            
            if response.count > 0:
                google_agent = Agent(
                    name="Google_Specialist",
                    role="Handle Google services operations",
                    model=Gemini(id="gemini-2.5-flash"),
                    tools=[GoogleEmailTools(user_id=user_id), GoogleDriveTools(user_id=user_id)],
                    instructions=[
                        "Handle Gmail and Google Drive operations",
                        "Search, read, and manage emails and documents",
                        "Provide Google services integration"
                    ],
                    debug_mode=debug_mode
                )
                integration_agents.append(google_agent)
        except Exception as e:
            logger.error(f"Could not setup Google integration: {e}")
    
    if not integration_agents:
        # Create a basic integration agent if no specific integrations are available
        basic_agent = Agent(
            name="Basic_Integration_Agent",
            role="Handle basic integration tasks",
            model=Gemini(id="gemini-2.5-flash"),
            instructions=[
                "Handle basic integration and API tasks",
                "Provide guidance on available integrations"
            ],
            debug_mode=debug_mode
        )
        integration_agents.append(basic_agent)
    
    integration_team = AIOS_PatchedTeam(
        name="Integration Team",
        mode="route",
        model=Gemini(id="gemini-2.5-flash"),
        members=integration_agents,
        instructions=[
            "Route integration requests to appropriate specialists",
            "Handle GitHub, Google, and other service integrations",
            "Coordinate between different service APIs"
        ],
        enable_agentic_context=True,
        share_member_interactions=True,
        show_members_responses=True,
        markdown=True,
        debug_mode=debug_mode
    )
    
    return integration_team

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
    enable_structured_output: bool = True,
) -> Team:
    
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

    # Team-level tools
    team_tools = [
        update_team_memory,
        retrieve_team_memory, 
        list_team_memory,
        update_shared_context,
        get_shared_context
    ]

    # Core tools
    core_tools = []
    if calculator:
        core_tools.append(CalculatorTools(
            add=True, subtract=True, multiply=True, divide=True,
            exponentiate=True, factorial=True, is_prime=True, square_root=True,
        ))

    if internet_search:
        core_tools.append(GoogleSearchTools(fixed_max_results=15))

    # Create specialized teams/agents
    team_members = []
    
    # Research Team
    if internet_search or web_crawler:
        research_team = create_research_team(user_id=user_id, debug_mode=debug_mode)
        team_members.append(research_team)

    # Development Team  
    if coding_assistant:
        dev_team = create_development_team(session_info=session_info, debug_mode=debug_mode)
        team_members.append(dev_team)

    # Integration Team
    if enable_github or enable_google_email or enable_google_drive:
        integration_team = create_integration_team(user_id=user_id, debug_mode=debug_mode)
        team_members.append(integration_team)

    # Investment Specialist
    if investment_assistant:
        investor_agent = Agent(
            name="Investment_Specialist",
            role="Generate investment reports and analysis",
            model=Gemini(id="gemini-2.5-flash"),
            instructions=[
                "Create comprehensive investment reports with:",
                "- Market overview and analysis",
                "- Core financial metrics",
                "- Growth prospects and risks", 
                "- Recent news and developments",
                "- Investment recommendation with rationale"
            ],
            tools=[YFinanceTools(stock_price=True, company_info=True, analyst_recommendations=True, company_news=True)],
            markdown=True,
            debug_mode=debug_mode,
        )
        team_members.append(investor_agent)

    # Shared team state for coordination
    shared_state = {
        "current_task_context": {},
        "shared_findings": [],
        "user_preferences": {},
        "session_metadata": session_info or {},
        "active_integrations": []
    }

    # Core instructions for team coordination
    core_instructions = [
        "You are Aetheria AI - an advanced multi-agent system coordinator.",
        "COORDINATION STRATEGY:",
        "1. Analyze incoming requests to determine task type and complexity",
        "2. Delegate to appropriate specialized teams or agents:",
        "   - Research Team: Information gathering, web search, content analysis",
        "   - Development Team: Code planning, execution, and review",
        "   - Integration Team: GitHub, Google services, API operations",
        "   - Investment Specialist: Financial analysis and recommendations",
        "3. Synthesize outputs from multiple agents into cohesive responses",
        "4. Maintain shared context and coordinate between team members",
        "5. Update team memory with important findings and decisions",
        "",
        "EXECUTION PRINCIPLES:",
        "- Always update shared context when receiving important information",
        "- Use team memory to track ongoing tasks and decisions",
        "- Coordinate between agents to avoid duplicate work",
        "- Provide comprehensive responses that integrate multiple perspectives",
        "- Be efficient - don't over-delegate simple tasks"
    ]

    # Add conditional instructions based on enabled features
    if use_memory:
        core_instructions.append("- Leverage team memory and search knowledge base for context")
    if calculator:
        core_instructions.append("- Use calculator tools for precise mathematical operations")
    if enable_structured_output:
        core_instructions.append("- Provide structured responses with task analysis and confidence scores")

    # Create the main coordinating team
    llm_os = AIOS_PatchedTeam(
        user_id=user_id,
        name="Aetheria AI System",
        mode="coordinate",  # Explicit coordination mode
        model=Gemini(id="gemini-2.5-flash"),
        description="Advanced AI system with specialized teams for comprehensive task handling",
        instructions=core_instructions,
        
        # Team composition
        members=team_members,
        tools=team_tools + core_tools,
        
        # Advanced team features
        enable_agentic_context=True,
        share_member_interactions=True,
        team_session_state=shared_state,
        
        # Storage and memory
        storage=PostgresStorage(
            table_name="ai_os_sessions",
            db_url=db_url_sqlalchemy,
            schema="public",
            auto_upgrade_schema=True
        ),
        memory=memory,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        
        # Execution settings
        stream_intermediate_steps=True,
        show_tool_calls=True,
        search_knowledge=use_memory,
        read_chat_history=True,
        add_history_to_messages=True,
        num_history_responses=30,
        markdown=True,
        add_datetime_to_instructions=True,
        
        # Structured output
        response_model=AetheriaResponse if enable_structured_output else None,
        
        # UI settings
        show_members_responses=True,
        introduction="Hi! I'm Aetheria AI - an advanced multi-agent system. I coordinate specialized teams to handle complex tasks efficiently. What can I help you with today?",
        debug_mode=debug_mode,
    )
    
    return llm_os