"""Search activity carries links while the agent keeps the original search text."""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from activity_stream import ActivityStream
from tool_event_payload import serialize_tool_event


@pytest.mark.parametrize("name,key", [
    ("web_search", "href"), ("search_news", "url"),
    ("duckduckgo_search", "href"), ("duckduckgo_news", "url"),
])
def test_search_projection_preserves_native_result_and_identity(name, key):
    original = json.dumps([
        {key: "HTTPS://Example.com:443/page?q=one&sort=two#section", "body": "Private snippet", "title": "Title"},
        {key: "https://example.com/page?q=one&sort=two#section"},
        {key: "https://example.com/other"},
    ])
    native = SimpleNamespace(tool_call_id="call-1", tool_name=name, tool_args={"query": "query"}, result=original)
    event = serialize_tool_event(native)
    assert native.result == original
    assert event["tool_call_id"] == "call-1"
    assert event["tool_args"] == {"query": "query"}
    assert event["metadata"]["inline"]["links"] == [
        {"url": "https://example.com/page?q=one&sort=two#section"}, {"url": "https://example.com/other"},
    ]
    assert event["metadata"]["state"] == "ready"
    assert "Private snippet" not in json.dumps(event)
    assert "Title" not in json.dumps(event)


@pytest.mark.parametrize("url", [
    "javascript:alert(1)", "data:text/html,hello", "file:///secret", "https://user:pass@example.com/",
    "https://example.com:bad/", "https://example.com:99999/", "https://[broken/", "https:///",
    "https://example.com/\nsecret", "https://example.com/a b", "https://example.com\\@other.com/",
])
def test_invalid_links_are_not_sent_to_frontend(url):
    event = serialize_tool_event({"tool_name": "web_search", "result": [{"href": url}, None, 42]})
    assert event["metadata"]["inline"]["links"] == []
    assert event["metadata"]["state"] == "unavailable"


@pytest.mark.parametrize("result,failed,state", [
    ([], False, "empty"), ("[broken", False, "unavailable"),
    ("Provider error with private details", True, "failed"),
])
def test_search_states_do_not_expose_raw_errors(result, failed, state):
    event = serialize_tool_event({"tool_name": "web_search", "result": result, "tool_call_error": failed})
    assert event["metadata"]["state"] == state
    assert event["tool_output"]["ok"] is not failed
    assert "private details" not in json.dumps(event)


def test_mobile_search_and_other_tool_previews_are_unchanged():
    for name, output in [
        ("web_search", {"status": "success", "action": "web_search", "data": {"query": "weather"}}),
        ("take_screenshot", {"metadata": {"kind": "computer_tool_output", "output_id": "screen"}}),
        ("read_range", {"metadata": {"kind": "google_sheets_tool_output"}}),
        ("create_image", {"metadata": {"kind": "generated_image_tool_output"}}),
        ("other_search", [{"href": "https://example.com/", "body": "Keep this"}]),
    ]:
        assert serialize_tool_event({"tool_name": name, "result": output})["tool_output"] == output
    assert "tool_output" not in serialize_tool_event({"tool_name": "web_search", "tool_call_id": "started"})


def test_search_journal_keeps_parallel_results_separate_without_snippets(tmp_path):
    from agno.db.sqlite import SqliteDb
    from agno.run.agent import RunOutput
    from agno.session import AgentSession

    db = SqliteDb(db_file=str(tmp_path / "search.sqlite"))
    run = RunOutput(run_id="run", agent_id="agent", session_id="chat", user_id="user", content="Answer")
    db.upsert_session(AgentSession(session_id="chat", user_id="user", agent_id="agent", runs=[run]))
    db.upsert_run(run, session_id="chat", user_id="user")
    stream = ActivityStream(SimpleNamespace(emit=lambda *args, **kwargs: None), "message")
    for call in ["first", "second"]:
        stream.emit("agent_step", {"type": "tool_start", "name": "web_search", "tool_call_id": call})
    for call in ["second", "first"]:
        tool = serialize_tool_event({"tool_name": "web_search", "tool_call_id": call,
            "result": [{"href": f"https://example.com/{call}", "body": "Full snippet"}]})
        stream.emit("agent_step", {"type": "tool_end", "name": "web_search", "tool": tool})
    stream.persist(db, "run", "chat", "user")
    events = db.get_run("run").metadata["activity_events"]
    assert "Full snippet" not in json.dumps(events)
    assert [event["tool_call_id"] for event in events] == ["first", "second", "second", "first"]
    assert events[2]["tool"]["metadata"]["inline"]["links"] == [{"url": "https://example.com/second"}]


def test_real_agent_receives_full_search_result(tmp_path):
    from dataclasses import dataclass, field
    from agno.agent import Agent
    from agno.db.sqlite import SqliteDb
    from agno.models.openai import OpenAIChat
    from agno.models.response import ModelResponse
    from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall

    received = []

    @dataclass
    class ScriptedModel(OpenAIChat):
        script: list = field(default_factory=list)

        def invoke_stream(self, messages, **kwargs):
            received.extend(message.content for message in messages if message.role == "tool")
            yield ModelResponse(**self.script.pop(0))

    def web_search(query: str) -> str:
        """Search for a query."""
        return json.dumps([{"href": "https://example.com/", "body": "The agent needs this snippet"}])

    script = [{"tool_calls": [ChoiceDeltaToolCall(index=0, id="search", type="function",
        function={"name": "web_search", "arguments": '{"query":"example"}'})]}, {"content": "Answer"}]
    agent = Agent(model=ScriptedModel(api_key="test", script=script), tools=[web_search], telemetry=False,
        db=SqliteDb(db_file=str(tmp_path / "agent.sqlite")))
    projected = []
    for chunk in agent.run("Search", stream=True, stream_events=True):
        if getattr(chunk, "event", "") == "ToolCallCompleted":
            projected.append(serialize_tool_event(chunk.tool))
    assert any("The agent needs this snippet" in str(content) for content in received)
    assert "The agent needs this snippet" not in json.dumps(projected)
