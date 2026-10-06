"""Native Agno HITL translated into validated, persistent chat requests."""

import json
import time
import uuid
from typing import Any

from agno.tools.user_control_flow import UserControlFlowTools
from agno.tools.user_feedback import UserFeedbackTools
from functools import lru_cache
from sqlalchemy import Column, Float, Index, JSON, MetaData, String, Table, insert, select, update

from agno_storage import get_engine

QUESTION_TIMEOUT_SECONDS = 24 * 60 * 60
QUESTION_INSTRUCTIONS = (
    "Use ask_user for choices and get_user_input for text replies when missing information prevents useful work. "
    "Ask 1-3 concise questions together. Use 2-4 distinct options for choice questions. "
    "Never ask for information already supplied. Question text and field names must be unique within a request. "
    "Do not invent an answer or treat an unanswered question as approval."
)


def question_tools(enabled: bool) -> list:
    if not enabled:
        return []
    return [UserFeedbackTools(instructions=QUESTION_INSTRUCTIONS), UserControlFlowTools(instructions=QUESTION_INSTRUCTIONS)]


def display_questions(requirements: list) -> list[dict[str, Any]]:
    questions = []
    for requirement in requirements:
        agent = requirement.member_agent_name or "Assistant"
        if requirement.needs_user_feedback:
            seen = set()
            schema = requirement.user_feedback_schema or []
            if not 1 <= len(schema) <= 3:
                raise ValueError("Ask between one and three questions per tool call.")
            for index, question in enumerate(schema):
                if question.question in seen or not 1 <= len(question.question) <= 2000:
                    raise ValueError("Question text must be distinct and at most 2000 characters.")
                seen.add(question.question)
                options = [{"label": option.label, "description": option.description or ""} for option in question.options]
                labels = [option["label"] for option in options]
                if not 2 <= len(options) <= 4 or len(set(labels)) != len(labels) or any(not label or len(label) > 200 for label in labels):
                    raise ValueError("Questions need two to four distinct, short options.")
                questions.append({"id": f"{requirement.id}:{index}", "requirementId": requirement.id,
                    "key": question.question, "question": question.question, "header": question.header[:80],
                    "kind": "choice", "options": options, "multiSelect": question.multi_select, "agent": agent})
        elif requirement.needs_user_input:
            fields = [field for field in requirement.user_input_schema or [] if field.value is None]
            if not 1 <= len(fields) <= 3 or len({field.name for field in fields}) != len(fields):
                raise ValueError("Request one to three distinct input fields.")
            for index, field in enumerate(fields):
                field_type = field.field_type if isinstance(field.field_type, str) else getattr(field.field_type, "__name__", "str")
                if field_type not in {"str", "int", "float", "bool"}:
                    raise ValueError("User input supports text, number, integer, and boolean fields.")
                questions.append({"id": f"{requirement.id}:{index}", "requirementId": requirement.id,
                    "key": field.name, "question": field.description or field.name, "header": field.name[:80],
                    "kind": "text", "fieldType": field_type, "options": [], "multiSelect": False, "agent": agent})
        else:
            raise ValueError("This client only resolves native user input and feedback requirements.")
    if not questions or len(questions) > 24:
        raise ValueError("Invalid question request size.")
    return questions


def validate_answers(questions: list[dict], answers: Any) -> dict:
    if not isinstance(answers, dict) or set(answers) != {question["id"] for question in questions}:
        raise ValueError("Answer every question in this request.")
    validated = {}
    for question in questions:
        answer = answers[question["id"]]
        if question["kind"] == "choice":
            if not isinstance(answer, dict) or set(answer) - {"selected", "text"}:
                raise ValueError("Invalid choice answer.")
            selected, custom = answer.get("selected", []), answer.get("text", "")
            labels = {option["label"] for option in question["options"]}
            if not isinstance(selected, list) or any(not isinstance(value, str) or value not in labels for value in selected):
                raise ValueError("Choose only displayed options.")
            if len(set(selected)) != len(selected) or (not question["multiSelect"] and len(selected) > 1):
                raise ValueError("Invalid number of selected options.")
            if not isinstance(custom, str) or len(custom) > 8000:
                raise ValueError("Custom replies must be at most 8000 characters.")
            custom = custom.strip()
            if not selected and not custom:
                raise ValueError("Choose an option or enter a reply.")
            if selected and custom:
                raise ValueError("Choose options or provide a custom reply, not both.")
            validated[question["id"]] = {"selected": selected, "text": custom}
        else:
            if not isinstance(answer, str) or not answer.strip() or len(answer) > 8000:
                raise ValueError("Enter a reply of at most 8000 characters.")
            value = answer.strip()
            field_type = question.get("fieldType", "str")
            if field_type == "int":
                value = int(value)
            elif field_type == "float":
                import math
                value = float(value)
                if not math.isfinite(value):
                    raise ValueError("Enter a finite number.")
            elif field_type == "bool":
                if value.lower() not in {"true", "false", "yes", "no"}:
                    raise ValueError("Enter yes or no.")
                value = value.lower() in {"true", "yes"}
            validated[question["id"]] = value
    return validated


def apply_answers(requirements: list, questions: list[dict], answers: dict) -> None:
    for requirement in requirements:
        matching = [question for question in questions if question["requirementId"] == requirement.id]
        values = {}
        for question in matching:
            answer = answers[question["id"]]
            values[question["key"]] = (answer["selected"] or [answer["text"]]) if question["kind"] == "choice" else answer
        if requirement.needs_user_feedback:
            requirement.provide_user_feedback(values)
        elif requirement.needs_user_input:
            requirement.provide_user_input(values)
        if not requirement.is_resolved():
            raise ValueError("The request no longer matches the pending requirements.")


def restore_turn_media(run, media: tuple, database) -> None:
    """Reattach owned on-disk inputs without persisting binary media in run JSON."""
    images, audio, videos, files = media
    pending = [run]
    seen = set()
    while pending:
        current = pending.pop()
        if current.run_id in seen:
            continue
        seen.add(current.run_id)
        for message in reversed(current.messages or []):
            if message.role == "user":
                message.images = images or None
                message.audio = audio or None
                message.videos = videos or None
                message.files = files or None
                break
        for requirement in current.active_requirements:
            if requirement.member_run_id:
                member = database.get_run(requirement.member_run_id)
                if member is not None and member.is_paused:
                    requirement._member_run_response = member
                    pending.append(member)


def public_request(row: dict) -> dict:
    return {"requestId": str(row["request_id"]), "conversationId": row["conversation_id"],
        "id": row["message_id"], "runId": row["run_id"], "status": row["status"],
        "questions": row["questions"], "answers": row.get("answers"), "expiresAt": row["expires_at"],
        "channel": row["context"].get("channel", "chat"),
        "planRequestId": row["context"].get("turn_data", {}).get("plan_request_id")}


@lru_cache(maxsize=1)
def request_table() -> Table:
    metadata = MetaData()
    table = Table("agent_input_requests", metadata,
        Column("request_id", String, primary_key=True), Column("conversation_id", String, nullable=False),
        Column("message_id", String, nullable=False), Column("user_id", String, nullable=False),
        Column("run_id", String, nullable=False), Column("status", String, nullable=False, default="pending"),
        Column("questions", JSON, nullable=False), Column("context", JSON, nullable=False), Column("answers", JSON),
        Column("submission_id", String), Column("created_at", Float, nullable=False, default=time.time),
        Column("updated_at", Float, nullable=False, default=time.time), Column("expires_at", Float, nullable=False))
    Index("agent_input_requests_conversation", table.c.user_id, table.c.conversation_id, table.c.created_at)
    Index("agent_input_requests_open_run", table.c.run_id, unique=True,
        sqlite_where=table.c.status.in_(["pending", "resuming"]))
    return table


class QuestionRepository:
    def __init__(self, engine=None):
        self.engine = engine or get_engine()
        self.table = request_table()
        self.table.metadata.create_all(self.engine)

    def create(self, *, run, conversation_id: str, message_id: str, user_id: str, context: dict) -> dict:
        now = time.time()
        row = {"request_id": str(uuid.uuid4()), "conversation_id": conversation_id, "message_id": message_id,
            "user_id": user_id, "run_id": run.run_id, "questions": display_questions(run.active_requirements),
            "context": context, "status": "pending", "answers": None, "submission_id": None,
            "created_at": now, "updated_at": now, "expires_at": now + QUESTION_TIMEOUT_SECONDS}
        with self.engine.begin() as connection:
            connection.execute(insert(self.table).values(**row))
        return row

    def get(self, request_id: str, user_id: str) -> dict | None:
        uuid.UUID(request_id)
        with self.engine.connect() as connection:
            row = connection.execute(select(self.table).where(self.table.c.request_id == request_id,
                self.table.c.user_id == user_id)).mappings().one_or_none()
        return dict(row) if row else None

    def list_for_conversation(self, conversation_id: str, user_id: str, *, pending_only=False) -> list[dict]:
        now = time.time()
        scope = (self.table.c.conversation_id == conversation_id, self.table.c.user_id == user_id)
        with self.engine.begin() as connection:
            connection.execute(update(self.table).where(*scope, self.table.c.status == "pending",
                self.table.c.expires_at < now).values(status="expired", updated_at=now))
            connection.execute(update(self.table).where(*scope, self.table.c.status == "resuming",
                self.table.c.updated_at < now - 600).values(status="failed", updated_at=now))
            statement = select(self.table).where(*scope).order_by(self.table.c.created_at.desc()).limit(100)
            if pending_only:
                statement = statement.where(self.table.c.status.in_(["pending", "resuming"]))
            return [dict(row) for row in connection.execute(statement).mappings()]

    def submit(self, request_id: str, user_id: str, submission_id: str, answers: Any) -> tuple[dict, bool]:
        uuid.UUID(request_id)
        uuid.UUID(submission_id)
        expired = False
        with self.engine.begin() as connection:
            # SQLite has no SELECT FOR UPDATE. A reserved write lock serializes
            # competing answers before reading the request state.
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            row = connection.execute(select(self.table).where(self.table.c.request_id == request_id,
                self.table.c.user_id == user_id)).mappings().one_or_none()
            if not row:
                raise LookupError("Question request not found.")
            row = dict(row)
            if row["status"] != "pending":
                if row.get("submission_id") == submission_id and row["status"] in {"resuming", "answered"}:
                    return row, False
                raise ValueError("This request is no longer awaiting an answer.")
            if row["expires_at"] < time.time():
                connection.execute(update(self.table).where(self.table.c.request_id == request_id)
                    .values(status="expired", updated_at=time.time()))
                expired = True
            else:
                validated = validate_answers(row["questions"], answers)
                connection.execute(update(self.table).where(self.table.c.request_id == request_id)
                    .values(status="resuming", answers=validated, submission_id=submission_id, updated_at=time.time()))
                row.update(status="resuming", answers=validated, submission_id=submission_id)
        if expired:
            raise ValueError("This question request has expired.")
        return row, True

    def heartbeat(self, request_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(update(self.table).where(self.table.c.request_id == request_id,
                self.table.c.status == "resuming").values(updated_at=time.time()))

    def finish(self, request_id: str, status: str) -> dict | None:
        if status not in {"answered", "failed", "cancelled"}:
            raise ValueError("Invalid request status.")
        with self.engine.begin() as connection:
            connection.execute(update(self.table).where(self.table.c.request_id == request_id,
                self.table.c.status == "resuming").values(status=status, updated_at=time.time()))
            row = connection.execute(select(self.table).where(self.table.c.request_id == request_id)).mappings().one_or_none()
            return dict(row) if row else None

    def cancel(self, conversation_id: str, user_id: str) -> list[dict]:
        with self.engine.begin() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            scope = (self.table.c.conversation_id == conversation_id, self.table.c.user_id == user_id,
                self.table.c.status.in_(["pending", "resuming"]))
            rows = [dict(row) for row in connection.execute(select(self.table).where(*scope)).mappings()]
            connection.execute(update(self.table).where(*scope).values(status="cancelled", updated_at=time.time()))
        for row in rows:
            row["status"] = "cancelled"
        return rows
