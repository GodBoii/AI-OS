import json
import logging
import uuid
from typing import Any, Dict, Optional

from agno.run.agent import RunEvent
from agno.run.team import TeamRunEvent
from agno.tools import Toolkit

from coder_agent import get_coder_agent
from computer_agent import get_computer_agent

logger = logging.getLogger(__name__)


def _safe_json_like(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return text
        if text.startswith("{") or text.startswith("["):
            try:
                return json.loads(text)
            except Exception:
                return value
        return value
    return str(value)


def _serialize_tool_event(tool_obj: Any) -> Dict[str, Any] | None:
    if not tool_obj:
        return None

    tool_name = getattr(tool_obj, "tool_name", None)
    tool_output = _safe_json_like(getattr(tool_obj, "tool_output", None))
    tool_args = _safe_json_like(getattr(tool_obj, "tool_args", None))

    payload: Dict[str, Any] = {}
    if tool_name:
        payload["tool_name"] = tool_name
    if tool_args is not None:
        payload["tool_args"] = tool_args
    if tool_output is not None:
        payload["tool_output"] = tool_output
    return payload or None


class AgentDelegationTools(Toolkit):
    """
    Delegation tools exposed to Aetheria so the parent agent can spawn
    dedicated coder/computer agents while streaming their full traces to UI.
    """

    def __init__(
        self,
        user_id: Optional[str],
        session_info: Optional[Dict[str, Any]],
        session_id: Optional[str],
        message_id: Optional[str],
        socketio,
        sid: Optional[str],
        redis_client=None,
        use_memory: bool = False,
        debug_mode: bool = True,
        enable_github: bool = True,
        enable_coder: bool = True,
        enable_computer: bool = True,
    ):
        super().__init__(name="agent_delegation_tools")
        self.user_id = user_id
        self.session_info = session_info or {}
        self.session_id = session_id
        self.message_id = message_id
        self.socketio = socketio
        self.sid = sid
        self.redis_client = redis_client
        self.use_memory = use_memory
        self.debug_mode = debug_mode
        self.enable_github = enable_github
        self.enable_coder = enable_coder
        self.enable_computer = enable_computer

        if enable_coder:
            self.register(self.delegate_to_coder)
        if enable_computer:
            self.register(self.delegate_to_computer)

    def _emit(self, event_name: str, payload: Dict[str, Any]) -> None:
        if not self.socketio:
            return

        if self.session_id:
            room_name = f"conv:{self.session_id}"
            self.socketio.emit(event_name, payload, room=room_name)
            return

        if self.sid:
            self.socketio.emit(event_name, payload, room=self.sid)

    def _build_realtime_tool_config(self, delegation_id: str, delegated_agent: str) -> Dict[str, Any]:
        return {
            "socketio": self.socketio,
            "sid": self.sid,
            "message_id": self.message_id,
            "conversation_id": self.session_id,
            "redis_client": self.redis_client,
            "delegation_id": delegation_id,
            "delegated_agent": delegated_agent,
        }

    def _stream_delegated_run(self, delegated_agent: str, task_description: str) -> str:
        delegation_id = str(uuid.uuid4())
        frame_type = "terminal" if delegated_agent == "coder" else "tv"
        tool_name = f"delegate_to_{delegated_agent}"
        realtime_config = self._build_realtime_tool_config(
            delegation_id=delegation_id,
            delegated_agent=delegated_agent,
        )

        self._emit(
            "agent_step",
            {
                "type": "delegation_start",
                "id": self.message_id,
                "name": tool_name,
                "agent_name": "Aetheria_AI",
                "delegation_id": delegation_id,
                "delegated_agent": delegated_agent,
                "frame_type": frame_type,
                "task_description": task_description[:4000],
            },
        )

        if delegated_agent == "coder":
            child_agent = get_coder_agent(
                user_id=self.user_id,
                session_info=self.session_info,
                browser_tools_config=realtime_config,
                custom_tool_config=realtime_config,
                session_id=self.session_id,
                message_id=self.message_id,
                use_memory=self.use_memory,
                debug_mode=self.debug_mode,
                enable_github=self.enable_github,
                delegation_id=delegation_id,
                delegated_agent=delegated_agent,
            )
        else:
            child_agent = get_computer_agent(
                user_id=self.user_id,
                session_info=self.session_info,
                browser_tools_config=realtime_config,
                computer_tools_config=realtime_config,
                session_id=self.session_id,
                message_id=self.message_id,
                use_memory=self.use_memory,
                debug_mode=self.debug_mode,
                delegation_id=delegation_id,
                delegated_agent=delegated_agent,
            )

        final_chunks: list[str] = []

        try:
            for chunk in child_agent.run(
                input=task_description,
                session_id=self.session_id,
                session_state={"turn_context": {"user_message": task_description, "files": []}},
                stream=True,
                stream_intermediate_steps=True,
                add_history_to_context=True,
            ):
                if not chunk or not hasattr(chunk, "event"):
                    continue

                owner_name = getattr(chunk, "agent_name", None) or getattr(chunk, "team_name", None)
                owner_name = owner_name or (
                    "Aetheria_Coder" if delegated_agent == "coder" else "Aetheria_Computer"
                )

                if chunk.event in (RunEvent.run_content.value, TeamRunEvent.run_content.value):
                    if chunk.content:
                        text = str(chunk.content)
                        final_chunks.append(text)
                        self._emit(
                            "response",
                            {
                                "content": text,
                                "streaming": True,
                                "id": self.message_id,
                                "agent_name": owner_name,
                                "is_log": True,
                                "delegation_id": delegation_id,
                                "delegated_agent": delegated_agent,
                                "frame_type": frame_type,
                            },
                        )
                elif chunk.event in (RunEvent.tool_call_started.value, TeamRunEvent.tool_call_started.value):
                    tool_payload = _serialize_tool_event(getattr(chunk, "tool", None))
                    self._emit(
                        "agent_step",
                        {
                            "type": "tool_start",
                            "name": getattr(chunk.tool, "tool_name", None),
                            "agent_name": owner_name,
                            "id": self.message_id,
                            "tool": tool_payload,
                            "delegation_id": delegation_id,
                            "delegated_agent": delegated_agent,
                            "frame_type": frame_type,
                        },
                    )
                elif chunk.event in (RunEvent.tool_call_completed.value, TeamRunEvent.tool_call_completed.value):
                    tool_payload = _serialize_tool_event(getattr(chunk, "tool", None))
                    self._emit(
                        "agent_step",
                        {
                            "type": "tool_end",
                            "name": getattr(chunk.tool, "tool_name", None),
                            "agent_name": owner_name,
                            "id": self.message_id,
                            "tool": tool_payload,
                            "delegation_id": delegation_id,
                            "delegated_agent": delegated_agent,
                            "frame_type": frame_type,
                        },
                    )

            final_content = "".join(final_chunks).strip()
            self._emit(
                "agent_step",
                {
                    "type": "delegation_end",
                    "id": self.message_id,
                    "name": tool_name,
                    "agent_name": "Aetheria_AI",
                    "delegation_id": delegation_id,
                    "delegated_agent": delegated_agent,
                    "frame_type": frame_type,
                    "success": True,
                },
            )
            return final_content or f"{delegated_agent.title()} agent completed the task."

        except Exception as exc:
            logger.error(
                "Delegated %s run failed (session=%s, message_id=%s): %s",
                delegated_agent,
                self.session_id,
                self.message_id,
                exc,
                exc_info=True,
            )
            self._emit(
                "agent_step",
                {
                    "type": "delegation_end",
                    "id": self.message_id,
                    "name": tool_name,
                    "agent_name": "Aetheria_AI",
                    "delegation_id": delegation_id,
                    "delegated_agent": delegated_agent,
                    "frame_type": frame_type,
                    "success": False,
                    "error": str(exc),
                },
            )
            return f"Error while delegating to {delegated_agent} agent: {exc}"

    def delegate_to_coder(self, task_description: str) -> str:
        """
        Delegate a software-engineering task to the dedicated coder agent.
        Returns only the coder's final output to the parent agent.
        """
        if not self.enable_coder:
            return "Coder delegation is disabled for this session."
        if not task_description or not str(task_description).strip():
            return "Error: task_description is required."
        return self._stream_delegated_run("coder", str(task_description).strip())

    def delegate_to_computer(self, task_description: str) -> str:
        """
        Delegate a desktop/browser control task to the dedicated computer agent.
        Returns only the computer agent's final output to the parent agent.
        """
        if not self.enable_computer:
            return "Computer delegation is disabled for this session."
        if not task_description or not str(task_description).strip():
            return "Error: task_description is required."
        return self._stream_delegated_run("computer", str(task_description).strip())
