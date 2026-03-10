import os
from typing import Any, Dict, List, Optional, Union

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.models.openrouter import OpenRouter
from agno.tools import Toolkit

from database_tools import DatabaseTools
from deployed_project_tools import DeployedProjectTools
from github_tools import GitHubTools
from sandbox_persistence import get_persistence_service
from sandbox_tools import SandboxTools


def _db_url_sqlalchemy() -> str:
    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set.")
    return db_url_full.replace("postgresql://", "postgresql+psycopg2://")


def get_coder_agent(
    user_id: Optional[str] = None,
    session_info: Optional[Dict[str, Any]] = None,
    browser_tools_config: Optional[Dict[str, Any]] = None,
    custom_tool_config: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    message_id: Optional[str] = None,
    use_memory: bool = False,
    debug_mode: bool = True,
    enable_github: bool = True,
    delegation_id: Optional[str] = None,
    delegated_agent: Optional[str] = None,
) -> Agent:
    """
    Dedicated coding-only Agent used for project workspace mode.
    Persists sessions/runs in Postgres using the same DB backend as assistant.py.
    """
    _ = custom_tool_config

    db = PostgresDb(
        db_url=_db_url_sqlalchemy(),
        db_schema="public",
    )

    persistence_service = get_persistence_service()
    socketio_instance = browser_tools_config.get("socketio") if browser_tools_config else None
    sid = browser_tools_config.get("sid") if browser_tools_config else None
    redis_client_instance = browser_tools_config.get("redis_client") if browser_tools_config else None

    coder_tools: List[Union[Toolkit, callable]] = [
        SandboxTools(
            session_info=session_info or {},
            persistence_service=persistence_service,
            user_id=user_id,
            session_id=session_id,
            message_id=message_id,
            socketio=socketio_instance,
            sid=sid,
            redis_client=redis_client_instance,
            delegation_id=delegation_id,
            delegated_agent=delegated_agent,
        )
    ]

    if user_id:
        coder_tools.append(DeployedProjectTools(user_id=user_id))
        coder_tools.append(DatabaseTools(user_id=user_id))
        if enable_github:
            coder_tools.append(GitHubTools(user_id=user_id))

    return Agent(
        name="Aetheria_Coder",
        model=OpenRouter(id="nvidia/nemotron-3-nano-30b-a3b:free"),
        role=(
            "Dedicated software engineering agent for project mode. "
            "Executes coding, repository, sandbox, database, and deployment operations."
        ),
        tools=coder_tools,
        instructions=[
            "<system_instructions>",
            "You are Aetheria Coder. Focus only on software engineering tasks.",
            "Use deterministic implementation flow: inspect -> edit -> verify -> summarize.",
            "Workspace root: /home/sandboxuser/workspace.",
            "Prefer surgical edits over full-file rewrites.",
            "Before deployment/database operations, resolve project context first.",
            "Never expose provider secrets/tokens in frontend source.",
            "For deployed frontend DB calls, use runtime_query_endpoint with JSON { sql, params }.",
            "For deployed-site changes: copy_deployed_project -> edit -> redeploy_project.",
            "Keep responses concise, implementation-first, and verifiable.",
            "</system_instructions>",
            "",
            "<frontend>",
            "Build responsive, production-grade UI and preserve existing design language unless user requests redesign.",
            "Use semantic HTML and reusable CSS classes.",
            "When touching interaction flows, keep backward compatibility for existing controls.",
            "For file preview/edit features, handle large content safely and avoid blocking UI.",
            "Preserve accessibility basics (labels, keyboard behavior, focus states).",
            "</frontend>",
            "",
            "<backend>",
            "Validate/sanitize all inputs at API boundaries.",
            "Keep API response shapes stable for existing clients.",
            "Enforce ownership/auth checks for project/session/file access.",
            "Use explicit error handling and actionable error messages.",
            "Use parameterized data access patterns and avoid inline secrets.",
            "Protect deployment/runtime boundaries and avoid unsafe data exposure.",
            "</backend>",
        ],
        user_id=user_id,
        db=db,
        enable_agentic_memory=use_memory,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        stream_intermediate_steps=True,
        search_knowledge=False,
        add_history_to_context=True,
        num_history_runs=40,
        store_events=True,
        add_datetime_to_context=True,
        debug_mode=debug_mode,
    )
