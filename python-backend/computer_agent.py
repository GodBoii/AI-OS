import os
from typing import Any, Dict, List, Optional, Union

from agno.agent import Agent
from agno.db.postgres import PostgresDb
from agno.models.groq import Groq
from agno.tools import Toolkit

from browser_tools import BrowserTools
from browser_tools_server import ServerBrowserTools
from computer_tools import ComputerTools


def _db_url_sqlalchemy() -> str:
    db_url_full = os.getenv("DATABASE_URL")
    if not db_url_full:
        raise ValueError("DATABASE_URL environment variable is not set.")
    return db_url_full.replace("postgresql://", "postgresql+psycopg2://")


def get_computer_agent(
    user_id: Optional[str] = None,
    session_info: Optional[Dict[str, Any]] = None,
    browser_tools_config: Optional[Dict[str, Any]] = None,
    computer_tools_config: Optional[Dict[str, Any]] = None,
    session_id: Optional[str] = None,
    message_id: Optional[str] = None,
    use_memory: bool = False,
    debug_mode: bool = True,
    delegation_id: Optional[str] = None,
    delegated_agent: Optional[str] = None,
) -> Agent:
    """
    Dedicated desktop/browser automation agent used for computer workspace mode.
    """
    db = PostgresDb(
        db_url=_db_url_sqlalchemy(),
        db_schema="public",
    )

    tools: List[Union[Toolkit, callable]] = []

    if computer_tools_config:
        merged_computer_config = dict(computer_tools_config)
        if delegation_id and "delegation_id" not in merged_computer_config:
            merged_computer_config["delegation_id"] = delegation_id
        if delegated_agent and "delegated_agent" not in merged_computer_config:
            merged_computer_config["delegated_agent"] = delegated_agent
        tools.append(ComputerTools(**merged_computer_config))

    if browser_tools_config:
        device_type = (session_info or {}).get("device_type", "web")
        if device_type == "desktop":
            tools.append(BrowserTools(**browser_tools_config))
        else:
            tools.append(
                ServerBrowserTools(
                    session_id=session_id,
                    user_id=user_id,
                    socketio=browser_tools_config.get("socketio"),
                    sid=browser_tools_config.get("sid"),
                    redis_client=browser_tools_config.get("redis_client"),
                    message_id=message_id,
                )
            )

    return Agent(
        name="Aetheria_Computer",
        model=Groq(id="meta-llama/llama-4-scout-17b-16e-instruct"),
        role=(
            "Dedicated computer control and browser automation agent. "
            "Executes local desktop actions and interactive browser tasks."
        ),
        tools=tools,
        instructions=[
            "<system_instructions>",
            "You are Aetheria Computer. Focus only on computer-control and browser-automation tasks.",
            "Always check capability/permission state before first control action.",
            "For file operations: never use placeholder paths like /path/to/folder.",
            "When user says 'this folder' or selected scope, call get_status() and use scopes[0] as the base directory.",
            "For desktop actions: observe -> act -> verify loop with screenshots/status checks.",
            "For browser actions: get browser status first, then execute navigation/interactions.",
            "Use safe, reversible actions first; confirm destructive operations with user intent.",
            "Keep responses concise, action-oriented, and outcome-verified.",
            "</system_instructions>",
            "",
            "<tools>",
            "ComputerTools: request_permission, get_status, screenshot/mouse/keyboard/window/system operations.",
            "BrowserTools/ServerBrowserTools: browser status, navigation, interaction, extraction.",
            "</tools>",
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
