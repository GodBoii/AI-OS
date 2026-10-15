"""Run activity keeps invocation identity, ordering and stored run checkpoints."""

import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from activity_stream import ActivityStream
from tool_event_payload import serialize_tool_event


class Transport:
    def __init__(self):
        self.sent = []

    def emit(self, channel, payload, **kwargs):
        self.sent.append((channel, payload, kwargs))


def test_tool_serializer_preserves_native_identity_and_output():
    tool = SimpleNamespace(tool_call_id="call-1", tool_name="take_screenshot", tool_args={},
                           result='{"ok":true,"metadata":{"output_id":"screen-1"}}')
    result = serialize_tool_event(tool)
    assert result["tool_call_id"] == "call-1"
    assert result["tool_output"]["metadata"]["output_id"] == "screen-1"


def test_three_screenshots_have_independent_preview_ids_and_order():
    transport = Transport()
    stream = ActivityStream(transport, "message")
    for index in range(3):
        stream.emit("reasoning_step", {"step": f"Thinking {index}", "agent_name": "Computer"}, room="conv:chat")
        base = {"name": "take_screenshot", "agent_name": "Computer", "tool": {"tool_call_id": f"call-{index}"}}
        stream.emit("agent_step", {**base, "type": "tool_start"}, room="conv:chat")
        stream.emit("computer_tool_result_preview", {"tool_name": "take_screenshot", "metadata": {"output_id": f"screen-{index}"}}, room="conv:chat")
        stream.emit("agent_step", {**base, "type": "tool_end"}, room="conv:chat")
    previews = [payload for channel, payload, _ in transport.sent if channel == "computer_tool_result_preview"]
    assert [payload["tool_call_id"] for payload in previews] == ["call-0", "call-1", "call-2"]
    assert [event["sequence"] for event in stream.events] == list(range(1, 13))
    assert all(kwargs == {"room": "conv:chat"} for _, _, kwargs in transport.sent)


def test_parallel_preview_is_not_guessed_and_completions_keep_ids():
    transport = Transport()
    stream = ActivityStream(transport, "message")
    for call in ["a", "b"]:
        stream.emit("agent_step", {"type": "tool_start", "name": "screenshot", "tool_call_id": call})
    stream.emit("computer_tool_result_preview", {"tool_name": "screenshot"})
    assert "tool_call_id" not in transport.sent[-1][1]
    stream.emit("agent_step", {"type": "tool_end", "name": "screenshot", "tool_call_id": "b"})
    stream.emit("computer_tool_result_preview", {"tool_name": "screenshot"})
    assert transport.sent[-1][1]["tool_call_id"] == "a"


def test_concurrent_emit_and_continuation_keep_a_single_sequence():
    transport = Transport()
    stream = ActivityStream(transport, "message", [{"sequence": 4, "event_id": "message:4"}])
    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(lambda n: stream.emit("reasoning_step", {"step": str(n)}), range(30)))
    assert [event[1]["sequence"] for event in transport.sent] == list(range(5, 35))
    stream.emit("computer-command", {"request_id": "native-command"}, room="device")
    assert transport.sent[-1] == ("computer-command", {"request_id": "native-command"}, {"room": "device"})


def test_activity_persistence_preserves_real_agno_run(tmp_path):
    from agno.db.sqlite import SqliteDb
    from agno.run.agent import RunOutput
    from agno.session import AgentSession

    db = SqliteDb(db_file=str(tmp_path / "activity.sqlite"))
    run = RunOutput(run_id="run", agent_id="agent", user_id="user", session_id="chat", content="Final answer",
                    metadata={"existing": "preserved"}, last_checkpoint_at_message_index=7)
    db.upsert_session(AgentSession(session_id="chat", user_id="user", agent_id="agent", runs=[run]))
    db.upsert_run(run, session_id="chat", user_id="user")
    stream = ActivityStream(Transport(), "message")
    stream.emit("reasoning_step", {"step": "Before screenshot"})
    stream.persist(db, "run", "chat", "user")
    restored = db.get_run("run")
    assert restored.content == "Final answer"
    assert restored.last_checkpoint_at_message_index == 7
    assert restored.metadata["existing"] == "preserved"
    assert restored.metadata["activity_events"][0]["step"] == "Before screenshot"
    history = db.get_session(session_id="chat", user_id="user", deserialize=False)
    assert history["runs"][0]["metadata"]["activity_events"] == stream.events


def test_real_agno_stream_preserves_three_invocations(tmp_path):
    import json
    from dataclasses import dataclass, field
    from agno.agent import Agent
    from agno.db.sqlite import SqliteDb
    from agno.models.openai import OpenAIChat
    from agno.models.response import ModelResponse
    from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall

    @dataclass
    class ScriptedModel(OpenAIChat):
        script: list = field(default_factory=list)

        def invoke_stream(self, messages, **kwargs):
            yield ModelResponse(**self.script.pop(0))

    screenshots = []

    def take_screenshot() -> str:
        """Capture the current screen."""
        screenshots.append(f"screen-{len(screenshots) + 1}")
        return json.dumps({"metadata": {"output_id": screenshots[-1]}})

    script = [{"tool_calls": [ChoiceDeltaToolCall(index=0, id=f"call-{index}", type="function",
               function={"name": "take_screenshot", "arguments": "{}"})]} for index in range(3)]
    script.append({"content": "Final answer"})
    db = SqliteDb(db_file=str(tmp_path / "actual-agent.sqlite"))
    agent = Agent(name="Aetheria_AI", model=ScriptedModel(api_key="test", script=script), tools=[take_screenshot], db=db, telemetry=False)
    stream = ActivityStream(Transport(), "message")
    for chunk in agent.run("Inspect the screen", run_id="real-run", session_id="chat", user_id="user", stream=True, stream_events=True):
        if getattr(chunk, "event", "") in {"ToolCallStarted", "ToolCallCompleted"}:
            stream.emit("agent_step", {"type": "tool_start" if chunk.event == "ToolCallStarted" else "tool_end",
                        "name": chunk.tool.tool_name, "tool": serialize_tool_event(chunk.tool)})
    assert [event["tool_call_id"] for event in stream.events] == ["call-0", "call-0", "call-1", "call-1", "call-2", "call-2"]
    assert [event["tool"]["tool_output"]["metadata"]["output_id"] for event in stream.events if event["type"] == "tool_end"] == screenshots
    stream.persist(db, "real-run", "chat", "user")
    assert db.get_run("real-run").content == "Final answer"


def test_response_keeps_legacy_reasoning_field_without_duplicate_journal_text():
    transport = Transport()
    stream = ActivityStream(transport, "message")
    stream.emit("response", {"content": "Answer", "reasoning_content": "Already emitted", "reasoning_emitted": True})
    assert transport.sent[0][1]["reasoning_content"] == "Already emitted"
    assert "reasoning_content" not in stream.events[0]


def test_native_ids_are_scoped_to_their_delegated_agent():
    stream = ActivityStream(Transport(), "message")
    for delegation in ["first-agent", "second-agent"]:
        stream.emit("agent_step", {"type": "tool_start", "name": "screenshot", "agent_name": "Computer",
                                  "delegation_id": delegation, "tool_call_id": "call-0"})
    stream.emit("computer_tool_result_preview", {"tool_name": "screenshot", "delegation_id": "second-agent"})
    assert stream.events[0]["invocation_id"] != stream.events[1]["invocation_id"]
    assert stream.events[2]["invocation_id"] == stream.events[1]["invocation_id"]
