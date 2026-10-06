"""Shared Agno database and user-scoped history reads."""

from functools import lru_cache
import os
from pathlib import Path
from typing import Any

from agno.db.sqlite import SqliteDb
from sqlalchemy import Column, MetaData, String, Table, create_engine, event, text
from sqlalchemy.dialects.sqlite import insert


def storage_root() -> Path:
    default = "/data/aetheria" if os.name != "nt" else str(Path(__file__).resolve().parents[1] / ".local-data")
    root = Path(os.getenv("AGENT_STORAGE_ROOT", default)).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    return root


@lru_cache(maxsize=1)
def get_engine():
    engine = create_engine(f"sqlite:///{storage_root() / 'agents.sqlite3'}",
        connect_args={"check_same_thread": False, "timeout": 30}, pool_pre_ping=True)
    @event.listens_for(engine, "connect")
    def configure_sqlite(connection, _record):
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
    return engine


@lru_cache(maxsize=1)
def get_agno_db() -> SqliteDb:
    db = SqliteDb(db_engine=get_engine())
    for table_type in ("sessions", "runs", "memories"):
        db._get_table(table_type, create_table_if_not_found=True)
    title_table().metadata.create_all(get_engine())
    return db


@lru_cache(maxsize=1)
def title_table():
    return Table("local_titles", MetaData(), Column("session_id", String, primary_key=True),
        Column("user_id", String, nullable=False), Column("title", String, nullable=False))


def save_title(session_id: str, user_id: str, title: str) -> None:
    table = title_table()
    table.metadata.create_all(get_engine())
    with get_engine().begin() as connection:
        statement = insert(table).values(session_id=session_id, user_id=user_id, title=title[:120])
        connection.execute(statement.on_conflict_do_update(index_elements=["session_id"],
            set_={"title": title[:120]}, where=table.c.user_id == user_id))


def get_title(session_id: str, user_id: str) -> str | None:
    get_agno_db()
    with get_engine().connect() as connection:
        return connection.execute(text("SELECT title FROM local_titles WHERE session_id=:id AND user_id=:owner"),
            {"id": session_id, "owner": user_id}).scalar_one_or_none()


def list_sessions(user_id: str, limit: int = 20, offset: int = 0) -> list[dict]:
    get_agno_db()
    with get_engine().connect() as connection:
        rows = connection.execute(text("""SELECT s.session_id,s.user_id,s.session_type,s.agent_id,s.team_id,s.created_at,
            coalesce(t.title,'Untitled conversation') AS session_title FROM agno_sessions s
            LEFT JOIN local_titles t ON t.session_id=s.session_id AND t.user_id=s.user_id
            WHERE s.user_id=:owner AND coalesce(json_extract(s.metadata,'$.internal_plan'),0)=0
            ORDER BY s.created_at DESC,s.session_id LIMIT :limit OFFSET :offset"""),
            {"owner": user_id, "limit": max(1, min(limit, 100)), "offset": max(0, offset)}).mappings()
        return [{**row, "has_session_row": True, "has_title": row["session_title"] != "Untitled conversation"} for row in rows]


def conversation_owner(session_id: str) -> str | None:
    get_agno_db()
    with get_engine().connect() as connection:
        return connection.execute(
            text("SELECT user_id FROM agno_sessions WHERE session_id=:session_id"),
            {"session_id": session_id},
        ).scalar_one_or_none()


def session_history(session_id: str, user_id: str) -> dict[str, Any] | None:
    session = get_agno_db().get_session(session_id=session_id, user_id=user_id, deserialize=False)
    if isinstance(session, dict):
        session["session_title"] = get_title(session_id, user_id)
        return session
    return None

