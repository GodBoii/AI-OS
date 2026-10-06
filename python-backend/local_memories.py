"""User-scoped memory CRUD using the native local Agno table."""

from sqlalchemy import delete, insert, select, update
import time
from agno_storage import get_agno_db, get_engine


class MemoryRepository:
    def __init__(self):
        self.table = get_agno_db()._get_table("memories", create_table_if_not_found=True)
        self.engine = get_engine()

    def list(self, user_id: str, *, team_id: str | None = None, limit: int = 100) -> list[dict]:
        query = select(self.table).where(self.table.c.user_id == user_id)
        if team_id:
            query = query.where(self.table.c.team_id == team_id)
        with self.engine.connect() as connection:
            return [dict(row) for row in connection.execute(query.order_by(self.table.c.updated_at.desc()).limit(limit)).mappings()]

    def get(self, memory_id: str, user_id: str) -> dict | None:
        with self.engine.connect() as connection:
            row = connection.execute(select(self.table).where(self.table.c.memory_id == memory_id,
                self.table.c.user_id == user_id)).mappings().one_or_none()
        return dict(row) if row else None

    def create(self, row: dict) -> dict:
        row = {"created_at": int(time.time()), **row}
        with self.engine.begin() as connection:
            connection.execute(insert(self.table).values(**row))
        return self.get(row["memory_id"], row["user_id"])

    def update(self, memory_id: str, user_id: str, values: dict) -> dict | None:
        with self.engine.begin() as connection:
            connection.execute(update(self.table).where(self.table.c.memory_id == memory_id,
                self.table.c.user_id == user_id).values(**values))
        return self.get(memory_id, user_id)

    def delete(self, memory_id: str, user_id: str) -> None:
        with self.engine.begin() as connection:
            connection.execute(delete(self.table).where(self.table.c.memory_id == memory_id,
                self.table.c.user_id == user_id))
