# python-backend/assistant.py (Final, Corrected Version for Agno v2.0.7 - Path B)

import os
import base64
import traceback
import logging
import uuid
from typing import Optional, List, Dict, Any, Union

# Agno Core Imports
from agno.agent import Agent
from agno.team import Team  # <-- Use the standard Team class
from agno.media import Image
from agno.tools import tool

# V2 Imports
from agno.run.team import TeamRunEvent
from agno.run.agent import RunEvent
from agno.db.postgres import PostgresDb
from agno.models.groq import Groq
from agno.models.google import Gemini

# Tool Imports
from agno.tools import Toolkit
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.website import WebsiteTools
from sandbox_tools import SandboxTools
from sandbox_persistence import get_persistence_service
from github_tools import GitHubTools
from google_email_tools import GoogleEmailTools
from google_drive_tools import GoogleDriveTools
from google_sheets_tools import GoogleSheetsTools
from browser_tools import BrowserTools
from browser_tools_server import ServerBrowserTools
from vercel_tools import VercelTools
from supabase_tools import SupabaseTools
from database_tools import DatabaseTools
from deployed_project_tools import DeployedProjectTools
from composio_tools import (
    ComposioWhatsAppTools,
    has_active_whatsapp_connection,
)
from agno.models.openrouter import OpenRouter
from agno.tools.trafilatura import TrafilaturaTools
from image_tools import ImageTools
from agent_delegation_tools import AgentDelegationTools

# Other Imports
from supabase_client import supabase_client

logger = logging.getLogger(__name__)


def get_llm_os(
    user_id: Optional[str] = None,
    session_info: Optional[Dict[str, Any]] = None,
    internet_search: bool = False,
    coding_assistant: bool = False,
    Planner_Agent: bool = True,
    enable_supabase: bool = False,
    use_memory: bool = False,
    debug_mode: bool = True,
    enable_github: bool = False,
    enable_vercel: bool = False,
    enable_google_email: bool = False,
    enable_google_drive: bool = False,
    enable_google_sheets: bool = False,
    enable_composio_whatsapp: bool = False,
    enable_browser: bool = False,
    enable_computer_control: bool = False,
    browser_tools_config: Optional[Dict[str, Any]] = None,
    computer_tools_config: Optional[Dict[str, Any]] = None,
    custom_tool_config: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None, 
    message_id: Optional[str] = None, 
) -> Team:
    """
    hierarchical Aetheria AI multi-agent system with integrated planner.
    """
    direct_tools: List[Union[Toolkit, callable]] = []

    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set.")
    db_url_sqlalchemy = db_url_full.replace("postgresql://", "postgresql+psycopg2://")

    # This PostgresDb object is now the single source of truth for persistence.
    # The Team will use it automatically to save runs and memories to Supabase.
    db = PostgresDb(
        db_url=db_url_sqlalchemy,
        db_schema="public"

    )

    if enable_github and user_id:
        direct_tools.append(GitHubTools(user_id=user_id))
    if (enable_google_email or enable_google_drive or enable_google_sheets) and user_id:
        if enable_google_email:
            direct_tools.append(GoogleEmailTools(user_id=user_id))
        if enable_google_drive:
            direct_tools.append(GoogleDriveTools(user_id=user_id))
        if enable_google_sheets:
            direct_tools.append(GoogleSheetsTools(user_id=user_id))
    if internet_search:
        direct_tools.append(DuckDuckGoTools())
    if enable_browser and browser_tools_config:
        # CRITICAL: Select browser tool based on device type from session
        device_type = session_info.get('device_type', 'web') if session_info else 'web'
        
        if device_type == 'desktop':
            # Desktop (Electron): Use client-side browser automation
            logger.info(f"[Browser Tool] Using CLIENT-SIDE browser for desktop (session: {session_id})")
            direct_tools.append(BrowserTools(**browser_tools_config))
        else:
            # Mobile/Web: Use server-side browser automation
            logger.info(f"[Browser Tool] Using SERVER-SIDE browser for {device_type} (session: {session_id})")
            direct_tools.append(ServerBrowserTools(
                session_id=session_id,
                user_id=user_id,
                socketio=browser_tools_config.get('socketio'),
                sid=browser_tools_config.get('sid'),
                redis_client=browser_tools_config.get('redis_client'),
                message_id=message_id
            ))
    
    if enable_vercel and user_id:
        direct_tools.append(VercelTools(user_id=user_id))
    if enable_supabase and user_id:
        direct_tools.append(SupabaseTools(user_id=user_id))
    if enable_composio_whatsapp and user_id and os.getenv("COMPOSIO_API_KEY"):
        if has_active_whatsapp_connection(user_id=user_id):
            direct_tools.append(ComposioWhatsAppTools(user_id=user_id))
        else:
            logger.info("Composio WhatsApp not active for user %s. Toolkit not injected.", user_id)
    if custom_tool_config:
        direct_tools.append(ImageTools(custom_tool_config=custom_tool_config))

    # Expose explicit delegation tools so Aetheria can spawn dedicated coder/computer runs
    # while preserving full trace visibility in the reasoning UI.
    socketio_instance = browser_tools_config.get("socketio") if browser_tools_config else None
    sid = browser_tools_config.get("sid") if browser_tools_config else None
    redis_client_instance = browser_tools_config.get("redis_client") if browser_tools_config else None
    has_socket_context = bool(socketio_instance and sid and session_id and message_id)
    can_delegate_coder = bool(has_socket_context and coding_assistant)
    # Computer delegation requires Redis pub/sub for request/response bridging.
    can_delegate_computer = bool(has_socket_context and enable_computer_control and redis_client_instance)
    if can_delegate_coder or can_delegate_computer:
        direct_tools.append(
            AgentDelegationTools(
                user_id=user_id,
                session_info=session_info,
                session_id=session_id,
                message_id=message_id,
                socketio=socketio_instance,
                sid=sid,
                redis_client=redis_client_instance,
                use_memory=use_memory,
                debug_mode=debug_mode,
                enable_github=enable_github,
                enable_coder=can_delegate_coder,
                enable_computer=can_delegate_computer,
            )
        )

    main_team_members: List[Union[Agent, Team]] = []

    if Planner_Agent:
        planner = Agent(
            name="REASONING AGENT",
            role="Planning agent analyzes complex queries and outputs a step-by-step execution plan for Aetheria AI. Call this first for any non-trivial task.",
            model=Groq(id="groq/compound"),
            instructions=[
                "You are the **Reasoning Agent** in Aetheria AI. Your only job is to analyze complex user queries and output a clean execution plan for Aetheria AI to follow. You do NOT execute tasks or answer questions directly.",
                "",
                "## Output Format",
                "",
                "Always respond in markdown. Provide a plan of **3 to 7 steps**. Each step must be **2 lines max** — one for the action, one for the reason. After the plan, you may optionally add notes.",
                "",
                "```",
                "## Plan: [one-line task summary]",
                "**Tools:** [Tool1, Tool2, ...]",
                "",
                "1. **[Action]** — [brief reason]",
                "2. **[Action]** — [brief reason]",
                "...",
                "",
                "note :- [optional caveats or prerequisites]",
                "important :- [critical ordering or constraints]",
                "diagram :- [mermaid code if helpful]",
                "```",
                "",
                "## Available Tools & Agents",
                "",
                "<query>",
                "**Aetheria AI (direct tools)** — handles these itself, never delegates:",
                "- `GitHubTools` — list/create repos, commit files, branches, PRs, issues",
                "- `VercelTools` — deploy projects, manage env vars, domains, deployments. **Requires GitHubTools data first (IMMUTABLE git connection)**",
                "- `BrowserTools` — browser automation. **Always call `get_status()` first. Stops if not connected.**",
                "- `SupabaseTools` — manage projects, storage buckets, secrets, edge functions",
                "- `GoogleEmailTools` — read, send, search, reply, label emails",
                "- `GoogleDriveTools` — search, read, create, share files",
                "- `GoogleSheetsTools` — search sheets, list tabs, inspect sheet info, read/batch-read ranges, write/append/batch-write/clear ranges, add/rename/delete tabs, create spreadsheets",
                "- `ImageTools.generate_image(prompt)` — AI image generation",
                "- `composio_whatsapp_tools` — **always call `list_whatsapp_actions()` first**, then execute with exact tool_slug",
                "- `DuckDuckGoTools` — web search/ internet search",
                "- `delegate_to_coder(task_description)` — when available, run dedicated coder agent for coding/build/debug/deployment tasks in main mode",
                "- `delegate_to_computer(task_description)` — when available, run dedicated computer agent for desktop/browser control tasks in main mode",
                "</query>",
                "",
                "<coding_agent>",
                "**dev_team (delegate coding/database/deployment tasks)** — has three toolkits:",
                "",
                "`SandboxTools` — code execution & file management:",
                "- `get_workspace_overview()` → `search_code()` / `read_file()` → `edit_file()` / `write_file()` → `execute_in_sandbox(command)`",
                "- Sandbox auto-creates and persists across the session. Workspace root: `/home/sandboxuser/workspace`",
                "",
                "`DeployedProjectTools` — inspect & retrieve live deployed site files:",
                "- `get_deployed_projects()` — list all deployed sites",
                "- `select_project(site_id|slug|hostname|url|default)` — set active project context",
                "- `get_deployment(site_id?, deployment_id?)` — get deployment details",
                "- `get_file_structure(site_id?, deployment_id?)` — list all deployed files",
                "- `get_file_content(path, site_id?, deployment_id?)` — read a deployed file's source",
                "- **Always call `get_deployed_projects()` then `select_project()` first before any deployment action**",
                "",
                "`DatabaseTools` — per-site database (Turso/SQLite) provisioning & operations:",
                "- `create_database(site_id?)` — provision a new database for a site",
                "- `run_query(sql, site_id?, params?)` — execute a SELECT/INSERT/UPDATE/DELETE (positional `?` params)",
                "- `migrate_database(migration_sql, site_id?)` — apply semicolon-separated DDL/DML migration",
                "- `get_db_credentials(site_id?, include_secrets?)` — get hostname, URL, runtime_query_endpoint",
                "- `delete_database(site_id?)` — remove database from provider and metadata",
                "- **For frontend deployed-site code: NEVER embed DB tokens or call provider APIs directly. Use `runtime_query_endpoint` from `get_db_credentials()` with `{ sql, params }` JSON.**",
                "</coding_agent>",
                "",
                "",
                "<computer_agent>",
                "**Computer_Agent (delegate desktop control tasks)** — screenshot, mouse/keyboard control, window management, file system, shell commands. Always starts with `request_permission()` then `take_screenshot()`.",
                "</computer_agent>",
                "",
                "## Key Rules",
                "- For simple/conversational queries, reply: `No plan needed — this is a simple query.`",
                "- Always respect tool ordering: GitHub metadata → Vercel; Browser status → Browser actions; list_actions → execute (Composio WhatsApp)",
                "- In main mode, prefer explicit delegation tools (if available): coding → `delegate_to_coder(...)`, desktop → `delegate_to_computer(...)`",
                "- You may still use `dev_team` when tool-based delegation is unavailable or not appropriate",
                "- Never skip prerequisite steps (status checks, ID lookups, list calls)",
            ],
            debug_mode=debug_mode,
        )
        main_team_members.append(planner)

    if coding_assistant:
        # Initialize persistence service for sandbox tools
        persistence_service = get_persistence_service()
        
        # Extract socketio and sid from browser_tools_config if available
        socketio_instance = browser_tools_config.get('socketio') if browser_tools_config else None
        sid = browser_tools_config.get('sid') if browser_tools_config else None
        redis_client_instance = browser_tools_config.get('redis_client') if browser_tools_config else None
        dev_tools: List[Union[Toolkit, callable]] = [
            SandboxTools(
                session_info=session_info,
                persistence_service=persistence_service,
                user_id=user_id,
                session_id=session_id,
                message_id=message_id,
                socketio=socketio_instance,
                sid=sid,
                redis_client=redis_client_instance
            )
        ]
        if user_id:
            dev_tools.append(DeployedProjectTools(user_id=user_id))
            dev_tools.append(DatabaseTools(user_id=user_id))
        
        dev_team = Agent(
            name="dev_team",
            model=OpenRouter(id="minimax/minimax-m2.7"),
            role="Full-stack software engineer with a persistent sandbox/ terminal, deployed project access, and a database engine. Delegate all coding, debugging, building, querying, and deployment tasks here.",
            tools=dev_tools,
            instructions=[
                "<system_instructions>",
                "You are a Coding Sub-Agent under Aetheria AI — the user talks to Aetheria AI directly, which delegates tasks to you. Stay aware of your position: execute precisely, report results cleanly.",
                "Access user-uploaded files from session_state['turn_context']['files'].",
                "Workspace root: /home/sandboxuser/workspace — keep all project files here.",
                "Deterministic edit contract: get_workspace_overview → search_code → read_file → edit_file/write_file → execute_in_sandbox.",
                "Prefer edit_file for surgical changes. Avoid full-file rewrites unless truly necessary.",
                "Before any database or deployment action: call get_deployed_projects() then select_project(site_id|slug|hostname|url|default) to lock project context.",
                "If a site is not yet deployed/live, do NOT add runtime database integration code to frontend files.",
                "NEVER call provider endpoints (e.g. api.turso.*) directly from frontend. NEVER embed DB tokens in frontend files.",
                "For deployed frontend DB calls: use runtime_query_endpoint from get_db_credentials() with JSON { sql, params }. Keep all auth server-side.",
                "For deployed-site edits: copy_deployed_project(site_id, deployment_id?, target_dir) → edit files → redeploy_project(site_id, project_directory).",
                "For follow-up DB work: always re-resolve the correct project context before applying changes.",
                "Keep responses under 300 words unless the implementation genuinely requires more.",
                "</system_instructions>",
                "",
                "<frontend>",
                "Build production-grade UIs — avoid generic AI slop. Every interface should feel crafted and intentional.",
                "Typography: Pick fonts that are beautiful, distinctive, and purposeful — not system defaults.",
                "Color & Theme: Commit to a cohesive visual identity. No random color mixing. Use a defined palette.",
                "Motion: Add meaningful animations and micro-interactions — hover states, transitions, loading feedback.",
                "Spatial Composition: Use whitespace, grid, and visual hierarchy to guide the eye naturally.",
                "Backgrounds & Visual Details: Avoid plain white/grey. Use gradients, textures, or layered elements to add depth.",
                "Components: Build reusable, accessible components. Prefer semantic HTML. Style with precision.",
                "Responsive: All UIs must work across screen sizes — mobile-first where applicable.",
                "</frontend>",
                "",
                "<backend>",
                "Write clean, modular backend code — functions/classes should do one thing well.",
                "Always validate and sanitize inputs server-side. Never trust client-provided data.",
                "Use environment variables for secrets and config — never hardcode credentials.",
                "Handle errors explicitly: use try/except (Python) or try/catch (JS), return meaningful error messages.",
                "For APIs: follow REST conventions — correct HTTP methods, status codes, and JSON response shapes.",
                "For database work: always use parameterized queries. Run migrations before runtime code changes.",
                "Log meaningfully — enough to debug, not so much it's noise.",
                "Test critical paths: run execute_in_sandbox to verify behavior before reporting done.",
                "</backend>",
                "",
                "<tools>",
                "SandboxTools: get_workspace_overview, search_code, read_file, write_file, edit_file, execute_in_sandbox",
                "DeployedProjectTools: get_deployed_projects, select_project, get_deployment, get_file_structure, get_file_content",
                "DatabaseTools: create_database, run_query (positional ? params), migrate_database, get_db_credentials, delete_database",
                "</tools>",
            ],
            debug_mode=debug_mode
        )
        main_team_members.append(dev_team)

    aetheria_instructions = [
        "<system_instructions>",
        "You are Aetheria AI — the most advanced AI system in the world, providing deeply personalized responses using all available user context.",
        "Access context via session_state['turn_context'].",
        "Users talk directly to you. You have sub-agents and direct tools at your disposal — use them silently and effectively.",
        "ALWAYS consult the 'planner' agent first for any non-trivial query to get a structured execution plan.", 
        "When delegation tools are available in main mode, use `delegate_to_coder(task_description)` for coding tasks and `delegate_to_computer(task_description)` for desktop/browser control tasks.",
        "Use every available tool and method to fulfil user demands — exhaust all options before giving up.",
        "If a tool or method fails, silently try alternatives. Never surface internal errors or system operations to the user",
        "Never use phrases like 'I will now', 'based on my knowledge', 'I was informed by', 'delegating to', or any language that exposes internal processes.",
        "Deliver every result as if you personally completed it — natural, direct, and focused entirely on user value.",
        "Never explain what tools you used, which agents you called, or what happened internally.",
        "</system_instructions>",
        "",
        "<tools>",
        "You directly own and execute these tools — never delegate tasks that require them:",
        "• GitHubTools — repos, branches, commits, PRs, issues",
        "• VercelTools — deployments, projects, env vars, domains (always get GitHub repo data first)",
        "• SupabaseTools — projects, storage, secrets, edge functions",
        "• BrowserTools — browser automation (always check get_status() first)",
        "• GoogleEmailTools — read, send, search, reply, label emails",
        "• GoogleDriveTools — search, read, create, share files",
        "• GoogleSheetsTools — search sheets, list tabs, inspect sheet info, read/batch-read ranges, write/append/batch-write/clear ranges, add/rename/delete tabs, create spreadsheets",
        "• ImageTools — AI image generation via generate_image(prompt)",
        "• composio_whatsapp_tools — list_whatsapp_actions() first, then execute with exact tool_slug",
        "• DuckDuckGoTools — web search",
        "• delegate_to_coder — dedicated coding-agent execution (available in realtime main-mode sessions)",
        "• delegate_to_computer — dedicated computer-agent execution (available in realtime main-mode sessions with computer control enabled)",
        "</tools>",
    ]
    # --- CRITICAL CHANGE: Instantiate the standard Team class ---
    # This allows the `db` object to automatically handle session persistence.
    llm_os_team = Team(
        name="Aetheria_AI",
        model=Gemini(id="gemini-2.5-flash"), # Gemini(id="gemini-2.5-flash"), Groq(id="moonshotai/kimi-k2-instruct-0905"),
        members=main_team_members,
        tools=direct_tools,
        instructions=aetheria_instructions,
        user_id=user_id,
        db=db,  # This now controls persistence
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
        add_datetime_to_context=True,
        debug_mode=debug_mode,
    )

    return llm_os_team

