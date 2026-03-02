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
from agno.models.google import Gemini
from agno.models.groq import Groq

# Tool Imports
from agno.tools import Toolkit
from agno.tools.duckduckgo import DuckDuckGoTools
from agno.tools.website import WebsiteTools
from agno.tools.hackernews import HackerNewsTools
from agno.tools.wikipedia import WikipediaTools
from agno.tools.arxiv import ArxivTools
from sandbox_tools import SandboxTools
from sandbox_persistence import get_persistence_service
from github_tools import GitHubTools
from google_email_tools import GoogleEmailTools
from google_drive_tools import GoogleDriveTools
from browser_tools import BrowserTools
from browser_tools_server import ServerBrowserTools
from computer_tools import ComputerTools
from vercel_tools import VercelTools
from supabase_tools import SupabaseTools
from database_tools import DatabaseTools
from deployed_project_tools import DeployedProjectTools
from composio_tools import (
    ComposioGoogleSheetsTools,
    ComposioWhatsAppTools,
    has_active_google_sheets_connection,
    has_active_whatsapp_connection,
)
from agno.tools.api import CustomApiTools
from agno.models.openrouter import OpenRouter
from agno.tools.trafilatura import TrafilaturaTools
from image_tools import ImageTools
from agno.tools.youtube import YouTubeTools

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
    enable_composio_google_sheets: bool = False,
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
    if (enable_google_email or enable_google_drive) and user_id:
        if enable_google_email:
            direct_tools.append(GoogleEmailTools(user_id=user_id))
        if enable_google_drive:
            direct_tools.append(GoogleDriveTools(user_id=user_id))
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
    if enable_composio_google_sheets and user_id and os.getenv("COMPOSIO_API_KEY"):
        if has_active_google_sheets_connection(user_id=user_id):
            direct_tools.append(ComposioGoogleSheetsTools(user_id=user_id))
        else:
            logger.info("Composio Google Sheets not active for user %s. Toolkit not injected.", user_id)
    if enable_composio_whatsapp and user_id and os.getenv("COMPOSIO_API_KEY"):
        if has_active_whatsapp_connection(user_id=user_id):
            direct_tools.append(ComposioWhatsAppTools(user_id=user_id))
        else:
            logger.info("Composio WhatsApp not active for user %s. Toolkit not injected.", user_id)
    if custom_tool_config:
        direct_tools.append(ImageTools(custom_tool_config=custom_tool_config))

    main_team_members: List[Union[Agent, Team]] = []

    if Planner_Agent:
        planner = Agent(
            name="REASONING AGENT",
            role="Planning agent Ã¢â‚¬â€ analyzes complex queries and outputs a step-by-step execution plan for Aetheria AI. Call this first for any non-trivial task.",
            model=Groq(id="groq/compound"),
            instructions=[
                "You are the **Reasoning Agent** in Aetheria AI. Your only job is to analyze complex user queries and output a clean execution plan for Aetheria AI to follow. You do NOT execute tasks or answer questions directly.",
                "",
                "## Output Format",
                "",
                "Always respond in markdown. Provide a plan of **3 to 7 steps**. Each step must be **2 lines max** Ã¢â‚¬â€ one for the action, one for the reason. After the plan, you may optionally add notes.",
                "",
                "```",
                "## Plan: [one-line task summary]",
                "**Tools:** [Tool1, Tool2, ...]",
                "",
                "1. **[Action]** Ã¢â‚¬â€ [brief reason]",
                "2. **[Action]** Ã¢â‚¬â€ [brief reason]",
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
                "**Aetheria AI (direct tools)** Ã¢â‚¬â€ handles these itself, never delegates:",
                "- `GitHubTools` Ã¢â‚¬â€ list/create repos, commit files, branches, PRs, issues",
                "- `VercelTools` Ã¢â‚¬â€ deploy projects, manage env vars, domains, deployments. **Requires GitHubTools data first (IMMUTABLE git connection)**",
                "- `BrowserTools` Ã¢â‚¬â€ browser automation. **Always call `get_status()` first. Stops if not connected.**",
                "- `SupabaseTools` Ã¢â‚¬â€ manage projects, storage buckets, secrets, edge functions",
                "- `GoogleEmailTools` Ã¢â‚¬â€ read, send, search, reply, label emails",
                "- `GoogleDriveTools` Ã¢â‚¬â€ search, read, create, share files",
                "- `ImageTools.generate_image(prompt)` Ã¢â‚¬â€ AI image generation",
                "- `composio_google_sheets_tools` Ã¢â‚¬â€ **always call `list_google_sheets_actions()` first**, then execute with exact tool_slug",
                "- `composio_whatsapp_tools` Ã¢â‚¬â€ **always call `list_whatsapp_actions()` first**, then execute with exact tool_slug",
                "- `DuckDuckGoTools` Ã¢â‚¬â€ web search/ internet search",
                "</query>",
                "",
                "<coding_agent>",
                "**dev_team (delegate coding/database/deployment tasks)** Ã¢â‚¬â€ has three toolkits:",
                "",
                "`SandboxTools` Ã¢â‚¬â€ code execution & file management:",
                "- `get_workspace_overview()` -> `search_code()` / `read_file()` -> `create_file()` / `create_and_write()` / `edit_file()` / `append_file_chunk()` / `write_file()` -> `execute_in_sandbox(command)`",
                "- Sandbox auto-creates and persists across the session. Workspace root: `/home/sandboxuser/workspace`",
                "- For large generated files: prefer `create_file` + repeated `append_file_chunk` (or `chunk_base64`) to avoid oversized function-argument JSON payloads.",
                "- `write_file`/`create_and_write` require explicit `file_path` + `content`; optional aliases are fallback only.",
                "- `read_file` accepts `file_path|path|filename`; `edit_file` accepts `search_text|find_text` and `replace_text|replacement`.",
                "",
                "`DeployedProjectTools` Ã¢â‚¬â€ inspect & retrieve live deployed site files:",
                "- `get_deployed_projects()` Ã¢â‚¬â€ list all deployed sites",
                "- `select_project(site_id|slug|hostname|url|default)` Ã¢â‚¬â€ set active project context",
                "- `get_deployment(site_id?, deployment_id?)` Ã¢â‚¬â€ get deployment details",
                "- `get_file_structure(site_id?, deployment_id?)` Ã¢â‚¬â€ list all deployed files",
                "- `get_file_content(path, site_id?, deployment_id?)` Ã¢â‚¬â€ read a deployed file's source",
                "- **Always call `get_deployed_projects()` then `select_project()` first before any deployment action**",
                "",
                "`DatabaseTools` Ã¢â‚¬â€ per-site database (Turso/SQLite) provisioning & operations:",
                "- `create_database(site_id?)` Ã¢â‚¬â€ provision a new database for a site",
                "- `run_query(sql, site_id?, params?)` Ã¢â‚¬â€ execute a SELECT/INSERT/UPDATE/DELETE (positional `?` params)",
                "- `migrate_database(migration_sql, site_id?)` Ã¢â‚¬â€ apply semicolon-separated DDL/DML migration",
                "- `get_db_credentials(site_id?, include_secrets?)` Ã¢â‚¬â€ get hostname, URL, runtime_query_endpoint",
                "- `delete_database(site_id?)` Ã¢â‚¬â€ remove database from provider and metadata",
                "- **For frontend deployed-site code: NEVER embed DB tokens or call provider APIs directly. Use `runtime_query_endpoint` from `get_db_credentials()` with `{ sql, params }` JSON.**",
                "</coding_agent>",
                "",
                "<world_agent>",
                "**World_Agent (delegate research tasks)** Ã¢â‚¬â€ has:",
                "- `WikipediaTools` Ã¢â‚¬â€ general knowledge",
                "- `ArxivTools` Ã¢â‚¬â€ academic papers",
                "- `HackerNewsTools` Ã¢â‚¬â€ tech/startup news",
                "- `YouTubeTools` Ã¢â‚¬â€ video captions and metadata",
                "- `CustomApiTools.make_request(method, endpoint, ...)` Ã¢â‚¬â€ REST API calls (GET/POST/PUT/DELETE, supports Bearer/Basic/API key auth)",
                "- `GoogleSearchTools` Ã¢â‚¬â€ general web search",
                "</world_agent>",
                "",
                "<computer_agent>",
                "**Computer_Agent (delegate desktop control tasks)** Ã¢â‚¬â€ screenshot, mouse/keyboard control, window management, file system, shell commands. Always starts with `request_permission()` then `take_screenshot()`.",
                "</computer_agent>",
                "",
                "## Key Rules",
                "- For simple/conversational queries, reply: `No plan needed Ã¢â‚¬â€ this is a simple query.`",
                "- Always respect tool ordering: GitHub metadata Ã¢â€ â€™ Vercel; Browser status Ã¢â€ â€™ Browser actions; list_actions Ã¢â€ â€™ execute (Composio)",
                "- Delegate: coding Ã¢â€ â€™ `dev_team`, research Ã¢â€ â€™ `World_Agent`, desktop Ã¢â€ â€™ `Computer_Agent`",
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
            model=OpenRouter(id="qwen/qwen3-vl-30b-a3b-thinking"),
            role="Full-stack software engineer with a persistent sandbox/ terminal, deployed project access, and a database engine. Delegate all coding, debugging, building, querying, and deployment tasks here.",
            tools=dev_tools,
            instructions=[
                "<system_instructions>",
                "You are a Coding Sub-Agent under Aetheria AI Ã¢â‚¬â€ the user talks to Aetheria AI directly, which delegates tasks to you. Stay aware of your position: execute precisely, report results cleanly.",
                "Access user-uploaded files from session_state['turn_context']['files'].",
                "Workspace root: /home/sandboxuser/workspace Ã¢â‚¬â€ keep all project files here.",
                "Deterministic edit contract: get_workspace_overview -> search_code -> read_file -> create_file/create_and_write/edit_file/append_file_chunk/write_file -> execute_in_sandbox.",
                "Prefer edit_file for surgical changes. Avoid full-file rewrites unless truly necessary.",
                "For new files use create_file(file_path=...) then edit_file, or create_and_write(file_path=..., content=...) for one-shot writes. For large content use append_file_chunk(file_path=..., chunk=...) with small chunks or base64.",
                "When writing content, always use explicit named args. Prefer content_base64/chunk_base64 when payload contains heavy quotes/newlines or is large.",
                "Before any database or deployment action: call get_deployed_projects() then select_project(site_id|slug|hostname|url|default) to lock project context.",
                "If a site is not yet deployed/live, do NOT add runtime database integration code to frontend files.",
                "NEVER call provider endpoints (e.g. api.turso.*) directly from frontend. NEVER embed DB tokens in frontend files.",
                "For deployed frontend DB calls: use runtime_query_endpoint from get_db_credentials() with JSON { sql, params }. Keep all auth server-side.",
                "For deployed-site edits: copy_deployed_project(site_id, deployment_id?, target_dir) Ã¢â€ â€™ edit files Ã¢â€ â€™ redeploy_project(site_id, project_directory).",
                "For follow-up DB work: always re-resolve the correct project context before applying changes.",
                "Keep responses under 300 words unless the implementation genuinely requires more.",
                "</system_instructions>",
                "",
                "<frontend>",
                "Build production-grade UIs Ã¢â‚¬â€ avoid generic AI slop. Every interface should feel crafted and intentional.",
                "Typography: Pick fonts that are beautiful, distinctive, and purposeful Ã¢â‚¬â€ not system defaults.",
                "Color & Theme: Commit to a cohesive visual identity. No random color mixing. Use a defined palette.",
                "Motion: Add meaningful animations and micro-interactions Ã¢â‚¬â€ hover states, transitions, loading feedback.",
                "Spatial Composition: Use whitespace, grid, and visual hierarchy to guide the eye naturally.",
                "Backgrounds & Visual Details: Avoid plain white/grey. Use gradients, textures, or layered elements to add depth.",
                "Components: Build reusable, accessible components. Prefer semantic HTML. Style with precision.",
                "Responsive: All UIs must work across screen sizes Ã¢â‚¬â€ mobile-first where applicable.",
                "</frontend>",
                "",
                "<backend>",
                "Write clean, modular backend code Ã¢â‚¬â€ functions/classes should do one thing well.",
                "Always validate and sanitize inputs server-side. Never trust client-provided data.",
                "Use environment variables for secrets and config Ã¢â‚¬â€ never hardcode credentials.",
                "Handle errors explicitly: use try/except (Python) or try/catch (JS), return meaningful error messages.",
                "For APIs: follow REST conventions Ã¢â‚¬â€ correct HTTP methods, status codes, and JSON response shapes.",
                "For database work: always use parameterized queries. Run migrations before runtime code changes.",
                "Log meaningfully Ã¢â‚¬â€ enough to debug, not so much it's noise.",
                "Test critical paths: run execute_in_sandbox to verify behavior before reporting done.",
                "</backend>",
                "",
                "<tools>",
                "SandboxTools: get_workspace_overview, search_code, read_file, create_file, append_file_chunk, create_and_write, write_file, edit_file, execute_in_sandbox",
                "DeployedProjectTools: get_deployed_projects, select_project, get_deployment, get_file_structure, get_file_content",
                "DatabaseTools: create_database, run_query (positional ? params), migrate_database, get_db_credentials, delete_database",
                "</tools>",
            ],
            debug_mode=debug_mode
        )
        main_team_members.append(dev_team)

    if World_Agent:
        world_ai = Agent(
            name="World_Agent",
            role="Research and information retrieval specialist. Delegate here for fetching, searching, or synthesizing external information Ã¢â‚¬â€ no code execution. Covers Wikipedia, ArXiv, Hacker News, YouTube transcripts, and direct REST API calls.",
            model=Gemini(id="gemini-2.5-flash-lite"),
            tools=[WikipediaTools(),HackerNewsTools(),ArxivTools(),CustomApiTools(),YouTubeTools()],
            instructions=[
                "You are the World Agent with comprehensive access to global information sources.",
                "Access context from session_state['turn_context'] for queries.",
                "", "AVAILABLE TOOLS:",
                "Ã¢â‚¬Â¢ WikipediaTools - Encyclopedic knowledge and factual information",
                "Ã¢â‚¬Â¢ ArxivTools - Academic papers and research publications",
                "Ã¢â‚¬Â¢ HackerNewsTools - Tech news, startup discussions",
                "Ã¢â‚¬Â¢ YouTubeTools - Video captions, transcripts, metadata, timestamps",
                "Ã¢â‚¬Â¢ CustomApiTools - Make HTTP requests to any external API",
                "", "TOOL SELECTION LOGIC:",
                "Ã¢â‚¬Â¢ General knowledge queries Ã¢â€ â€™ Wikipedia",
                "Ã¢â‚¬Â¢ Academic/research papers Ã¢â€ â€™ ArXiv",
                "Ã¢â‚¬Â¢ Tech news/trends Ã¢â€ â€™ HackerNews",
                "Ã¢â‚¬Â¢ YouTube video analysis/summarization Ã¢â€ â€™ YouTubeTools",
                "Ã¢â‚¬Â¢ External API data fetching Ã¢â€ â€™ CustomApiTools",
                "", "OUTPUT:",
                "Ã¢â‚¬Â¢ Deliver clear, comprehensive responses",
                "Ã¢â‚¬Â¢ Structure information logically",
                "Ã¢â‚¬Â¢ Include relevant data points and insights",
                "Ã¢â‚¬Â¢ Keep responses concise yet thorough"
            ],
            debug_mode=debug_mode,
        )
        main_team_members.append(world_ai)

    # NEW: Computer Agent - Handles all desktop computer control operations
    if enable_computer_control and computer_tools_config:
        device_type = session_info.get('device_type', 'web') if session_info else 'web'
        
        if device_type == 'desktop':
            logger.info(f"[Computer Agent] Enabling Computer Agent for desktop (session: {session_id})")
            
            computer_agent = Agent(
                name="Computer_Agent",
                role="Desktop computer automation and control agent. Delegate here for ANY task that requires directly controlling the user's local desktop machine",
                model=Groq(id="meta-llama/llama-4-scout-17b-16e-instruct"),
                tools=[ComputerTools(**computer_tools_config)],
                instructions=[
                    "You are the Computer Agent with complete control over the desktop computer.",
                    "Access context from session_state['turn_context'] for queries.",
                    "",
                    "CAPABILITIES:",
                    "You have 32 tools organized into 5 categories:",
                    "",
                    "1. PERMISSION & STATUS (2 tools):",
                    "   Ã¢â‚¬Â¢ get_status() - Check if computer control is enabled",
                    "   Ã¢â‚¬Â¢ request_permission() - Enable computer control (MUST call first)",
                    "",
                    "2. PERCEPTION - How you see the computer (5 tools):",
                    "   Ã¢â‚¬Â¢ take_screenshot() - Capture screen for vision analysis",
                    "   Ã¢â‚¬Â¢ get_active_window() - Get current window info",
                    "   Ã¢â‚¬Â¢ get_cursor_position() - Get mouse coordinates",
                    "   Ã¢â‚¬Â¢ read_clipboard() - Read clipboard contents",
                    "   Ã¢â‚¬Â¢ ocr_screen() - Extract text from screen",
                    "",
                    "3. INTERACTION - How you control the computer (6 tools):",
                    "   Ã¢â‚¬Â¢ move_mouse(x, y, smooth) - Move cursor",
                    "   Ã¢â‚¬Â¢ click_mouse(button, double, x, y) - Click mouse",
                    "   Ã¢â‚¬Â¢ type_text(text) - Type text",
                    "   Ã¢â‚¬Â¢ press_hotkey(keys) - Press key combinations",
                    "   Ã¢â‚¬Â¢ scroll(direction, amount) - Scroll wheel",
                    "   Ã¢â‚¬Â¢ drag_drop(from_x, from_y, to_x, to_y) - Drag and drop",
                    "",
                    "4. WINDOW MANAGEMENT (6 tools):",
                    "   Ã¢â‚¬Â¢ list_windows() - List all open windows",
                    "   Ã¢â‚¬Â¢ focus_window(window_id, title) - Focus window",
                    "   Ã¢â‚¬Â¢ resize_window(window_id, width, height) - Resize",
                    "   Ã¢â‚¬Â¢ minimize_window(window_id) - Minimize",
                    "   Ã¢â‚¬Â¢ maximize_window(window_id) - Maximize",
                    "   Ã¢â‚¬Â¢ close_window(window_id) - Close window",
                    "",
                    "5. SYSTEM CONTROL (11 tools):",
                    "   Ã¢â‚¬Â¢ run_command(command, timeout) - Execute shell command",
                    "   Ã¢â‚¬Â¢ list_files(directory) - List directory contents",
                    "   Ã¢â‚¬Â¢ read_file(file_path, encoding) - Read file",
                    "   Ã¢â‚¬Â¢ write_file(file_path, content, encoding) - Write file",
                    "   Ã¢â‚¬Â¢ delete_file(file_path) - Delete file/directory",
                    "   Ã¢â‚¬Â¢ create_directory(directory_path) - Create directory",
                    "   Ã¢â‚¬Â¢ open_application(app_name) - Open app",
                    "   Ã¢â‚¬Â¢ close_application(app_name) - Close app",
                    "   Ã¢â‚¬Â¢ get_volume() - Get system volume",
                    "   Ã¢â‚¬Â¢ set_volume(volume, mute) - Set volume/mute",
                    "   Ã¢â‚¬Â¢ get_system_info() - Get system information",
                    "",
                    "WORKFLOW - The Agentic Loop:",
                    "1. OBSERVE - Take screenshot, get active window, check cursor position",
                    "2. REASON - Analyze what you see using vision model",
                    "3. ACT - Execute mouse clicks, keyboard input, or system commands",
                    "4. VERIFY - Take another screenshot to confirm action completed",
                    "",
                    "CRITICAL RULES:",
                    "Ã¢â‚¬Â¢ ALWAYS call request_permission() before first use",
                    "Ã¢â‚¬Â¢ ALWAYS take screenshot before clicking (to get coordinates)",
                    "Ã¢â‚¬Â¢ Use vision model to analyze screenshots and find UI elements",
                    "Ã¢â‚¬Â¢ Verify actions completed by taking another screenshot",
                    "Ã¢â‚¬Â¢ For file operations, use absolute paths",
                    "Ã¢â‚¬Â¢ For commands, validate they're safe (no rm -rf /, format, etc.)",
                    "Ã¢â‚¬Â¢ When clicking, provide x,y coordinates from vision analysis",
                    "",
                    "VISION-BASED INTERACTION:",
                    "When user asks to click something:",
                    "1. take_screenshot() Ã¢â€ â€™ Get current screen",
                    "2. Analyze screenshot with vision model Ã¢â€ â€™ Find element coordinates",
                    "3. click_mouse(x=coord_x, y=coord_y) Ã¢â€ â€™ Click at coordinates",
                    "4. take_screenshot() Ã¢â€ â€™ Verify action completed",
                    "",
                    "PLATFORM-SPECIFIC NOTES:",
                    "Ã¢â‚¬Â¢ Windows: Use PowerShell commands, app names like 'notepad', 'chrome'",
                    "Ã¢â‚¬Â¢ macOS: Use bash/AppleScript, app names like 'Safari', 'TextEdit'",
                    "Ã¢â‚¬Â¢ Linux: Use bash commands, app names vary by distro",
                    "",
                    "OUTPUT STYLE:",
                    "Ã¢â‚¬Â¢ Describe what you're doing in natural language",
                    "Ã¢â‚¬Â¢ Report results clearly and concisely",
                    "Ã¢â‚¬Â¢ If action fails, explain why and suggest alternatives",
                    "Ã¢â‚¬Â¢ Keep responses focused on the task",
                    "",
                    "SAFETY:",
                    "Ã¢â‚¬Â¢ Dangerous commands are automatically blocked",
                    "Ã¢â‚¬Â¢ Always confirm destructive operations with user",
                    "Ã¢â‚¬Â¢ Respect system boundaries and user privacy",
                ],
                debug_mode=debug_mode,
            )
            main_team_members.append(computer_agent)

    aetheria_instructions = [
        "<system_instructions>",
        "You are Aetheria AI Ã¢â‚¬â€ the most advanced AI system in the world, providing deeply personalized responses using all available user context.",
        "Access context via session_state['turn_context'].",
        "Users talk directly to you. You have sub-agents and direct tools at your disposal Ã¢â‚¬â€ use them silently and effectively.",
        "ALWAYS consult the 'planner' agent first for any non-trivial query to get a structured execution plan.", 
        "Use every available tool and method to fulfil user demands Ã¢â‚¬â€ exhaust all options before giving up.",
        "If a tool or method fails, silently try alternatives. Never surface internal errors or system operations to the user",
        "Never use phrases like 'I will now', 'based on my knowledge', 'I was informed by', 'delegating to', or any language that exposes internal processes.",
        "Deliver every result as if you personally completed it Ã¢â‚¬â€ natural, direct, and focused entirely on user value.",
        "Never explain what tools you used, which agents you called, or what happened internally.",
        "</system_instructions>",
        "",
        "<tools>",
        "You directly own and execute these tools Ã¢â‚¬â€ never delegate tasks that require them:",
        "Ã¢â‚¬Â¢ GitHubTools Ã¢â‚¬â€ repos, branches, commits, PRs, issues",
        "Ã¢â‚¬Â¢ VercelTools Ã¢â‚¬â€ deployments, projects, env vars, domains (always get GitHub repo data first)",
        "Ã¢â‚¬Â¢ SupabaseTools Ã¢â‚¬â€ projects, storage, secrets, edge functions",
        "Ã¢â‚¬Â¢ BrowserTools Ã¢â‚¬â€ browser automation (always check get_status() first)",
        "Ã¢â‚¬Â¢ GoogleEmailTools Ã¢â‚¬â€ read, send, search, reply, label emails",
        "Ã¢â‚¬Â¢ GoogleDriveTools Ã¢â‚¬â€ search, read, create, share files",
        "Ã¢â‚¬Â¢ ImageTools Ã¢â‚¬â€ AI image generation via generate_image(prompt)",
        "Ã¢â‚¬Â¢ composio_google_sheets_tools Ã¢â‚¬â€ list_google_sheets_actions() first, then execute with exact tool_slug",
        "Ã¢â‚¬Â¢ composio_whatsapp_tools Ã¢â‚¬â€ list_whatsapp_actions() first, then execute with exact tool_slug",
        "Ã¢â‚¬Â¢ DuckDuckGoTools Ã¢â‚¬â€ web search",
        "</tools>",
    ]
    # --- CRITICAL CHANGE: Instantiate the standard Team class ---
    # This allows the `db` object to automatically handle session persistence.
    llm_os_team = Team(
        name="Aetheria_AI",
        model=Groq(id="moonshotai/kimi-k2-instruct-0905"), # Gemini(id="gemini-2.5-flash"), Groq(id="moonshotai/kimi-k2-instruct-0905"),
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

