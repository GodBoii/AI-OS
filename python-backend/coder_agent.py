import os
from typing import Any, Dict, List, Optional, Union

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.models.openrouter import OpenRouter
from agno.run.team import TeamRunEvent
from agno.team import Team
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
) -> Team:
    """
    Dedicated coding-only team used for project workspace mode.
    Persists sessions/runs in Postgres, same persistence model as assistant.py.
    """
    db = PostgresDb(
        db_url=_db_url_sqlalchemy(),
        db_schema="public",
    )

    persistence_service = get_persistence_service()
    socketio_instance = browser_tools_config.get("socketio") if browser_tools_config else None
    sid = browser_tools_config.get("sid") if browser_tools_config else None
    redis_client_instance = browser_tools_config.get("redis_client") if browser_tools_config else None

    dev_tools: List[Union[Toolkit, callable]] = [
        SandboxTools(
            session_info=session_info or {},
            persistence_service=persistence_service,
            user_id=user_id,
            session_id=session_id,
            message_id=message_id,
            socketio=socketio_instance,
            sid=sid,
            redis_client=redis_client_instance,
        )
    ]
    if user_id:
        dev_tools.append(DeployedProjectTools(user_id=user_id))
        dev_tools.append(DatabaseTools(user_id=user_id))
        if enable_github:
            dev_tools.append(GitHubTools(user_id=user_id))

    dev_team = Agent(
        name="dev_team",
        model=OpenRouter(id="qwen/qwen3-vl-30b-a3b-thinking"),
        role=(
            "Dedicated coding agent for project workspace mode. "
            "Handles code edits, terminal execution, repository operations, and redeploy flows."
        ),
        tools=dev_tools,
        instructions=[
            "<system_instructions>",
            "You are a dedicated coding agent. Do not behave as a general assistant.",
            "Workspace root: /home/sandboxuser/workspace.",
            "For code changes: inspect -> edit -> run checks/commands -> report concise results.",
            "Prefer surgical edits over full-file rewrites.",
            "Before deployment/database actions: resolve project context first.",
            "Never expose provider tokens in frontend code.",
            "For deployed frontend DB access, use runtime_query_endpoint with JSON { sql, params }.",
            "For live project updates: copy_deployed_project -> edit -> redeploy_project.",
            "</system_instructions>",
        ],
        debug_mode=debug_mode,
    )

    return Team(
        name="Aetheria_Coder",
        model=OpenRouter(id="qwen/qwen3-vl-30b-a3b-thinking"),
        members=[dev_team],
        tools=[] if not custom_tool_config else [],
        instructions=[
            "You are Aetheria Coder. Focus only on software engineering tasks.",
            "Keep responses concise and implementation-first.",
        ],
        user_id=user_id,
        db=db,
        enable_agentic_memory=use_memory,
        enable_user_memories=use_memory,
        enable_session_summaries=use_memory,
        stream_intermediate_steps=True,
        search_knowledge=False,
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
