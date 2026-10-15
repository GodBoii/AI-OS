"""Give the desktop's existing activity channels one ordered, replayable journal."""

from copy import deepcopy
from threading import RLock
from typing import Any
from uuid import uuid4


class ActivityStream:
    CHANNELS = {"reasoning_step", "agent_step", "response", "assistant_response_reset",
                "computer_tool_result_preview", "plan_response"}

    def __init__(self, transport: Any, message_id: str, events: list[dict] | None = None):
        self.transport = transport
        self.message_id = message_id
        self.events = list(events or [])
        self.sequence = max((event.get("sequence", 0) for event in self.events), default=0)
        self.pending: dict[str, dict] = {}
        self.lock = RLock()

    def __getattr__(self, name: str) -> Any:
        return getattr(self.transport, name)

    def emit(self, channel: str, payload: Any = None, *args: Any, **kwargs: Any) -> Any:
        if channel not in self.CHANNELS or not isinstance(payload, dict):
            return self.transport.emit(channel, payload, *args, **kwargs)
        # Assign and emit under the same lock so concurrent member events cannot overtake.
        with self.lock:
            data = dict(payload)
            tool = data.get("tool") or {}
            kind = data.get("step_type") or data.get("type")
            name = data.get("name") or data.get("tool_name") or tool.get("tool_name")
            call_id = data.get("tool_call_id") or tool.get("tool_call_id")
            if kind == "tool_start":
                call_id = call_id or str(uuid4())
                self.pending[call_id] = {"name": name, "delegation_id": data.get("delegation_id"),
                                         "agent_name": data.get("agent_name")}
            elif not call_id and (kind == "tool_end" or channel == "computer_tool_result_preview"):
                matches = [key for key, entry in self.pending.items()
                           if entry["name"] == name and entry["delegation_id"] == data.get("delegation_id")
                           and (not data.get("agent_name") or entry["agent_name"] == data["agent_name"])]
                # Never guess which parallel invocation produced a preview.
                if len(matches) == 1:
                    call_id = matches[0]
            if call_id:
                data["tool_call_id"] = str(call_id)
            if kind == "tool_end" and call_id:
                self.pending.pop(call_id, None)
            self.sequence += 1
            data.update(event_id=f"{self.message_id}:{self.sequence}", sequence=self.sequence)
            self.events.append({**deepcopy(data), "channel": channel})
            return self.transport.emit(channel, data, *args, **kwargs)

    def persist(self, db: Any, run_id: str, session_id: str, user_id: str) -> None:
        # Update the stored run, preserving its checkpoint, metrics, media and native events.
        run = db.get_run(run_id)
        if run is None:
            raise ValueError(f"Cannot save activity for missing run {run_id}")
        run.metadata = {**(run.metadata or {}), "activity_events": self.events}
        db.upsert_run(run, session_id=session_id, user_id=user_id)
