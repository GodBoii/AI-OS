"""Exercise real Flask/Socket.IO, local persistence, and Supabase auth with a scripted model.

Run in the backend container. Creates and removes one disposable auth user.
Uses a temporary local database; never records artificial usage in Convex.
"""

import os
os.environ.setdefault("EVENTLET_NO_GREENDNS", "yes")
import eventlet
eventlet.monkey_patch()

import json
import logging
import secrets
import sys
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
load_dotenv()
logging.basicConfig(level=logging.ERROR)

from agno.metrics import MessageMetrics
from agno.models.openai import OpenAIChat
from agno.models.response import ModelResponse
from agno.team import Team
from agno.agent import Agent
from openai.types.chat.chat_completion_chunk import ChoiceDeltaToolCall


@dataclass
class ScriptedModel(OpenAIChat):
    script: list = field(default_factory=list)
    def invoke_stream(self, messages, **kwargs):
        response = self.script.pop(0)
        if response.get("tool_calls"):
            response["tool_calls"] = [ChoiceDeltaToolCall(**call) for call in response["tool_calls"]]
        yield ModelResponse(**response, response_usage=MessageMetrics(input_tokens=10, output_tokens=5, total_tokens=15))


def main():
    with tempfile.TemporaryDirectory(prefix="aetheria-question-verification-") as directory:
        os.environ["AGENT_STORAGE_ROOT"] = directory
        os.environ["MEDIA_STORAGE_ROOT"] = str(Path(directory) / "media")
        import factory
        import task_poller
        import sockets
        import agent_runner
        from extensions import socketio
        from supabase_client import supabase_client
        from agno_storage import get_agno_db, save_title, conversation_owner
        from user_questions import question_tools, QuestionRepository

        task_poller.start_task_poller = lambda **kwargs: None
        app = factory.create_app()
        app.config["TESTING"] = True
        question = {"questions": [{"question": "Which platform?", "header": "Platform",
            "options": [{"label": "Linux"}, {"label": "Windows"}]}]}
        responses = [{"tool_calls": [{"index": 0, "id": "question-tool", "type": "function",
            "function": {"name": "ask_user", "arguments": json.dumps(question)}}]}, {"content": "Linux selected."}]
        def team(**kwargs):
            return Team(name="Aetheria_AI", user_id=kwargs["user_id"], model=ScriptedModel(script=responses),
                members=[], db=get_agno_db(), tools=question_tools(True), telemetry=False, store_events=True, store_media=False)
        agent_runner.get_llm_os = team
        agent_runner._log_request_tokens = lambda **kwargs: None
        sockets.generate_and_save_title = lambda session_id,user_id,message,timestamp: save_title(session_id,user_id,"Question verification")
        user = None
        client = None
        conversation = str(uuid.uuid4())
        try:
            email = f"question-check-{uuid.uuid4().hex}@example.invalid"
            password = secrets.token_urlsafe(32)
            user = supabase_client.auth.admin.create_user({"email": email, "password": password, "email_confirm": True}).user
            # Use a separate auth client so the backend service-role client keeps its admin identity.
            from supabase import create_client
            auth = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_PUBLISHABLE_KEY"])
            token = auth.auth.sign_in_with_password({"email": email, "password": password}).session.access_token
            headers = {"Authorization": f"Bearer {token}"}
            client = socketio.test_client(app, auth={"token": token})
            assert client.is_connected()
            client.emit("send_message", json.dumps({"conversationId": conversation, "id": "verify-message",
                "message": "Ask me which platform.", "accessToken": token, "supports_user_questions": True,
                "config": {"memory": False, "coding_assistant": False}}))
            question_request = None
            for _ in range(100):
                eventlet.sleep(0.05)
                for event in client.get_received():
                    if event["name"] == "user_question": question_request = event["args"][0]
                    if event["name"] == "error": raise AssertionError(event["args"][0].get("message"))
                if question_request: break
            assert question_request, "No question was emitted."
            assert conversation_owner(conversation) == str(user.id)
            assert QuestionRepository().get(question_request["requestId"], "other") is None
            client.disconnect()
            client = socketio.test_client(app, auth={"token": token})
            client.emit("join_conversation", {"conversationId": conversation, "accessToken": token})
            replay = [event for event in client.get_received() if event["name"] == "user_question"]
            assert replay and replay[0]["args"][0]["requestId"] == question_request["requestId"]
            submission = {"accessToken": token, "requestId": question_request["requestId"],
                "submissionId": str(uuid.uuid4()), "answers": {question_request["questions"][0]["id"]: {"selected": ["Linux"], "text": ""}}}
            client.emit("submit_user_answers", submission)
            done = False
            content = ""
            for _ in range(100):
                eventlet.sleep(0.05)
                for event in client.get_received():
                    if event["name"] == "response":
                        payload = event["args"][0]
                        content += str(payload.get("content") or "")
                        done = done or payload.get("done", False)
                    if event["name"] == "error": raise AssertionError(event["args"][0].get("message"))
                if done: break
            assert done and "Linux selected" in content, content
            client.emit("submit_user_answers", submission)
            assert any(event["name"] == "user_question_ack" and event["args"][0]["status"] == "answered"
                for event in client.get_received())
            http = app.test_client()
            history = http.get(f"/api/sessions/{conversation}/history", headers=headers)
            assert history.status_code == 200 and history.json["input_requests"][0]["status"] == "answered"
            upload = http.post("/api/generate-upload-url", headers=headers, json={"fileName": "test.png"})
            assert upload.status_code == 200
            from urllib.parse import urlsplit
            write = http.put(urlsplit(upload.json["signedURL"]).path, data=b"local-image", content_type="image/png")
            assert write.status_code == 201
            from local_media import media_storage
            read_url = media_storage().create_signed_url(upload.json["path"])["signed_url"]
            assert http.get(urlsplit(read_url).path).data == b"local-image"
            memory = http.post("/api/memories", headers=headers, json={"memory": "Prefers Linux", "topics": ["platform"]})
            assert memory.status_code == 201, memory.json
            plan_call = {"tool_calls": [{"index": 0, "id": "plan-question", "type": "function",
                "function": {"name": "ask_user", "arguments": json.dumps(question)}}]}
            plan_responses = [plan_call, {"content": "Plan for Linux."}]
            agent_runner.create_plan_agent = lambda **kwargs: Agent(name="plan_agent", user_id=kwargs["user_id"],
                model=ScriptedModel(script=plan_responses), db=get_agno_db(), tools=question_tools(True), telemetry=False)
            plan_request_id = str(uuid.uuid4())
            client.emit("plan_request", {"accessToken": token, "conversationId": conversation,
                "messageId": "plan-message", "requestId": plan_request_id, "message": "Plan this project.",
                "supports_user_questions": True, "config": {}})
            plan_question = None
            for _ in range(100):
                eventlet.sleep(0.05)
                for event in client.get_received():
                    if event["name"] == "user_question": plan_question = event["args"][0]
                    if event["name"] == "error": raise AssertionError(event["args"][0].get("message"))
                if plan_question: break
            assert plan_question and plan_question["channel"] == "plan"
            client.emit("submit_user_answers", {"accessToken": token, "requestId": plan_question["requestId"],
                "submissionId": str(uuid.uuid4()), "answers": {plan_question["questions"][0]["id"]: {"selected": ["Linux"], "text": ""}}})
            plan_done = None
            for _ in range(100):
                eventlet.sleep(0.05)
                for event in client.get_received():
                    if event["name"] == "plan_response" and event["args"][0].get("done"): plan_done = event["args"][0]
                if plan_done: break
            assert plan_done and plan_done["requestId"] == plan_request_id and "Linux" in plan_done["plan"]
            print("PASS: authenticated questions, reconnect, same-run continuation, duplicate reply, local history/media/memories, and plan-mode questions.")
        finally:
            if client and client.is_connected(): client.disconnect()
            if user: supabase_client.auth.admin.delete_user(str(user.id))
            sockets.run_state_manager_instance.clear(conversation)
            sockets.connection_manager_service.redis_client.delete(f"session:{conversation}")


if __name__ == "__main__":
    main()
