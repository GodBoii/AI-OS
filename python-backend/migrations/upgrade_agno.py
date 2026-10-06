"""Initialize local agent and media storage. This command never modifies Supabase."""

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv
load_dotenv(BACKEND / ".env")

from agno_storage import get_agno_db, storage_root
from user_questions import QuestionRepository
from local_media import media_storage


def main() -> None:
    get_agno_db()
    QuestionRepository()
    media_storage()
    print(f"Local Agno history, questions, and media initialized at {storage_root()}.")


if __name__ == "__main__":
    main()
