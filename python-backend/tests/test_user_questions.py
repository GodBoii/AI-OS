import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pytest
from agno.agent import Agent
from agno.db.sqlite import SqliteDb
from agno.models.openai import OpenAIChat
from agno.models.response import ModelResponse
from agno.metrics import MessageMetrics
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall
from agno.run.agent import RunOutput
from agno.run.team import TeamRunOutput
from agno.team import Team

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from user_questions import apply_answers, display_questions, question_tools, validate_answers


@dataclass
class ScriptedModel(OpenAIChat):
    """Only the external model transport is replaced; Agno executes the real tools."""
    script: list = field(default_factory=list)
    received: list = field(default_factory=list)

    def invoke_stream(self, messages, **kwargs):
        self.received.append([message.to_dict() for message in messages])
        response = self.script.pop(0)
        if response.get("tool_calls"):
            response["tool_calls"] = [ChoiceDeltaToolCall(**tool) for tool in response["tool_calls"]]
        yield ModelResponse(**response, response_usage=MessageMetrics(input_tokens=10, output_tokens=5, total_tokens=15))

    def invoke(self, messages, **kwargs):
        self.received.append([message.to_dict() for message in messages])
        return ModelResponse(**self.script.pop(0), response_usage=MessageMetrics(input_tokens=10, output_tokens=5, total_tokens=15))


def call(name, arguments, call_id="ask-1"):
    return {"tool_calls": [{"index": 0, "id": call_id, "type": "function",
        "function": {"name": name, "arguments": json.dumps(arguments)}}]}


def feedback():
    return call("ask_user", {"questions": [{"question": "Which platform?", "header": "Platform",
        "options": [{"label": "Windows"}, {"label": "Linux"}], "multi_select": False}]})


def output(stream):
    chunks = list(stream)
    return next(chunk for chunk in reversed(chunks) if isinstance(chunk, (RunOutput, TeamRunOutput)))


def test_agent_stream_pause_persists_and_new_instance_continues(tmp_path):
    db = SqliteDb(db_file=str(tmp_path / "runs.db"))
    model = ScriptedModel(script=[feedback()])
    agent = Agent(name="coder", model=model, db=db, tools=question_tools(True), telemetry=False)
    paused = output(agent.run("Build it", user_id="owner", session_id="chat", stream=True, stream_events=True, yield_run_output=True))
    assert paused.is_paused
    restored = db.get_run(paused.run_id)
    questions = display_questions(restored.active_requirements)
    answers = validate_answers(questions, {questions[0]["id"]: {"selected": [], "text": "macOS"}})
    apply_answers(restored.active_requirements, questions, answers)
    model = ScriptedModel(script=[{"content": "Building for macOS."}])
    resumed = Agent(name="coder", model=model, db=db, tools=question_tools(True), telemetry=False)
    result = output(resumed.continue_run(run_id=paused.run_id, session_id="chat", user_id="owner",
        requirements=restored.requirements, stream=True, stream_events=True, yield_run_output=True))
    assert not result.is_paused
    assert result.run_id == paused.run_id
    assert "macOS" in result.content
    assert any("macOS" in str(message) for message in model.received[0] if message["role"] == "tool")


def test_team_member_pause_and_second_question_round(tmp_path):
    db = SqliteDb(db_file=str(tmp_path / "team.db"))
    member = Agent(name="coder", model=ScriptedModel(script=[feedback()]), tools=question_tools(True), telemetry=False)
    leader = ScriptedModel(script=[call("delegate_task_to_member", {"member_id": "coder", "task": "Build it"})])
    team = Team(name="main", model=leader, members=[member], db=db, telemetry=False)
    paused = output(team.run("Build it", session_id="chat", user_id="owner", stream=True, stream_events=True, yield_run_output=True))
    assert paused.is_paused
    assert paused.active_requirements[0].member_agent_name == "coder"
    restored = db.get_run(paused.run_id)
    questions = display_questions(restored.active_requirements)
    apply_answers(restored.active_requirements, questions, validate_answers(questions,
        {questions[0]["id"]: {"selected": ["Linux"], "text": ""}}))
    next_question = call("get_user_input", {"user_input_fields": [{"field_name": "name", "field_type": "str",
        "field_description": "What should the project be called?"}]}, "ask-2")
    member = Agent(name="coder", model=ScriptedModel(script=[next_question]), tools=question_tools(True), telemetry=False)
    team = Team(name="main", model=ScriptedModel(script=[]), members=[member], db=db, telemetry=False)
    paused_again = output(team.continue_run(run_id=paused.run_id, session_id="chat", user_id="owner",
        requirements=restored.requirements, stream=True, stream_events=True, yield_run_output=True))
    assert paused_again.is_paused
    questions = display_questions(paused_again.active_requirements)
    apply_answers(paused_again.active_requirements, questions, validate_answers(questions, {questions[0]["id"]: "Workbench"}))
    member.model.script = [{"content": "Linux project Workbench ready."}]
    team.model.script = [{"content": "Workbench ready."}]
    result = output(team.continue_run(run_id=paused.run_id, session_id="chat", user_id="owner",
        requirements=paused_again.requirements, stream=True, stream_events=True, yield_run_output=True))
    assert result.status.value == "COMPLETED"
    assert result.run_id == paused.run_id


@pytest.mark.parametrize("answer", [{"selected": ["Other"], "text": ""}, {"selected": ["Windows", "Linux"], "text": ""},
    {"selected": [], "text": ""}, {"selected": ["Windows"], "text": "Linux"}, {"selected": ["Windows", "Windows"]}])
def test_invalid_choice_answers_are_rejected(answer):
    question = {"id": "q1", "kind": "choice", "options": [{"label": "Windows"}, {"label": "Linux"}], "multiSelect": False}
    with pytest.raises(ValueError):
        validate_answers([question], {"q1": answer})


def test_missing_and_extra_answers_rejected():
    with pytest.raises(ValueError):
        validate_answers([{"id": "q1"}], {"q2": "answer"})


@pytest.mark.parametrize("field_type,value,expected", [("int", "42", 42), ("float", "3.5", 3.5), ("bool", "no", False)])
def test_typed_fields(field_type, value, expected):
    assert validate_answers([{"id": "q1", "kind": "text", "fieldType": field_type}], {"q1": value})["q1"] == expected
