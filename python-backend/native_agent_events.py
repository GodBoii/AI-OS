"""Map native member streams to the desktop's existing delegation frames."""

class NativeMemberFrames:
    def __init__(self, root_agent, message_id, emit):
        self.root = root_agent
        self.message_id = message_id
        self.emit = emit
        self.started = set()

    def metadata(self, chunk) -> dict:
        owner = getattr(chunk, "agent_name", None) or getattr(chunk, "team_name", None)
        kind = {"Aetheria_Coder": "coder", "Aetheria_Computer": "computer"}.get(owner)
        run_id = getattr(chunk, "run_id", None)
        if not kind or owner == self.root.name or not run_id:
            return {}
        metadata = {"delegation_id": run_id, "delegated_agent": kind,
            "frame_type": "terminal" if kind == "coder" else "tv"}
        if run_id not in self.started:
            self.started.add(run_id)
            for member in self.root.members or []:
                if member.name == owner:
                    for toolkit in member.tools or []:
                        if hasattr(toolkit, "delegation_id"):
                            toolkit.delegation_id = run_id
                            toolkit.delegated_agent = kind
            self.emit("agent_step", {"id": self.message_id, "type": "delegation_start",
                "name": "delegate_task_to_member", "agent_name": self.root.name,
                "task_description": f"{kind.title()} task", **metadata})
        if getattr(chunk, "event", "") in {"RunCompleted", "RunError", "RunCancelled"}:
            self.emit("agent_step", {"id": self.message_id, "type": "delegation_end",
                "name": "delegate_task_to_member", "agent_name": self.root.name,
                "success": chunk.event == "RunCompleted", **metadata})
        return metadata
