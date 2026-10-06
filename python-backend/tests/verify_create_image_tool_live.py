"""Opt-in paid integration test with local images and disposable auth fixtures."""

import argparse
import json
import os
import secrets
import sys
import uuid
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))


class RecordedSocket:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any], dict[str, Any]]] = []

    def emit(self, event: str, payload: dict[str, Any], **kwargs: Any) -> None:
        self.events.append((event, payload, kwargs))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reference", type=Path, help="Edit an existing image instead of generating one.")
    args = parser.parse_args()
    load_dotenv(BACKEND / ".env")
    from agno.media import Image
    from agno.models.message import Message
    from media_tools import MediaTools
    from local_media import media_storage
    from sqlalchemy import select
    from model_routing import DEFAULT_MODEL_ID
    from primary_model_factory import get_primary_model
    from supabase_client import supabase_client

    args.output_dir.mkdir(parents=True, exist_ok=True)
    conversation_id = str(uuid.uuid4())
    user_id = None
    stage = "temporary user creation"
    try:
        user = supabase_client.auth.admin.create_user({
            "email": f"aios-image-test-{uuid.uuid4()}@example.invalid",
            "password": secrets.token_urlsafe(32),
            "email_confirm": True,
            "user_metadata": {"is_integration_test": True},
        })
        user_id = str(user.user.id)
        socket = RecordedSocket()
        tool = MediaTools({
            "user_id": user_id, "conversation_id": conversation_id,
            "message_id": str(uuid.uuid4()), "socketio": socket,
        })
        stage = "create_image generation and persistence"
        images = [Image(content=args.reference.read_bytes())] if args.reference else None
        prompt = "Change the bicycle frame to green and keep the cream background." if images else (
            "A flat illustration of a green bicycle on a cream background. No text."
        )
        result = tool.create_image(text=prompt, images=images)
        payload = json.loads(result.content)
        if not payload.get("ok") or not result.images:
            raise RuntimeError(payload.get("error") or "No tool image returned")
        metadata = payload["metadata"]
        stage = "signed URL retrieval"
        response = requests.get(metadata["media_url"], timeout=60)
        response.raise_for_status()
        if response.content != result.images[0].content:
            raise RuntimeError("Stored image bytes differ from model-visible image bytes")
        (args.output_dir / metadata["filename"]).write_bytes(response.content)
        stage = "saved content registry"
        rows = supabase_client.table("session_content").select("metadata").eq(
            "user_id", user_id
        ).eq("session_id", conversation_id).eq("reference_id", metadata["artifact_id"]).execute().data
        if len(rows) != 1 or rows[0]["metadata"]["model"] != metadata["model"]:
            raise RuntimeError("Generated image was not registered with the actual model")
        if len(socket.events) != 1 or socket.events[0][0] != "media_generated":
            raise RuntimeError("Missing media event")
        if socket.events[0][2].get("room") != f"conv:{conversation_id}":
            raise RuntimeError("Media event used the wrong conversation room")
        print(json.dumps({"tool": "create_image", "model": metadata["model"],
                          "cost_usd": metadata.get("cost_usd"), "bytes": len(response.content),
                          "storage_roundtrip": True, "history_registered": True, "event_room_verified": True}), flush=True)
        stage = "primary-model vision"
        model = get_primary_model(DEFAULT_MODEL_ID)
        message = Message(role="user", content="What color is the bicycle frame? Answer with only the color.", images=result.images)
        vision = requests.post("https://openrouter.ai/api/v1/chat/completions", timeout=(30, 180),
                               headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
                               json={"model": DEFAULT_MODEL_ID, "messages": [model._format_message(message)],
                                     "max_tokens": 1024})
        vision.raise_for_status()
        answer = vision.json()["choices"][0]["message"]["content"]
        if "green" not in str(answer).lower():
            raise RuntimeError("Primary model did not identify the generated frame color")
        print(json.dumps({"primary_model": DEFAULT_MODEL_ID, "vision_answer": answer, "vision_verified": True}), flush=True)
        return 0
    except Exception as exc:
        print(f"Live tool verification failed at {stage}: {type(exc).__name__}", file=sys.stderr, flush=True)
        return 1
    finally:
        if user_id:
            # Delete only this run's generated objects, registry rows, and test identity.
            prefix = f"{user_id}/{conversation_id}/generated"
            try:
                storage = media_storage()
                with storage.engine.connect() as connection:
                    paths = connection.execute(select(storage.table.c.path).where(
                        storage.table.c.path.startswith(prefix + "/", autoescape=True)
                    )).scalars().all()
                storage.remove(paths)
                supabase_client.table("session_content").delete().eq("user_id", user_id).eq(
                    "session_id", conversation_id
                ).execute()
                supabase_client.auth.admin.delete_user(user_id)
                print("Temporary integration fixtures removed.", flush=True)
            except Exception as exc:
                print(f"Temporary fixture cleanup failed: {type(exc).__name__}, test_user_id={user_id}", file=sys.stderr)
                raise


if __name__ == "__main__":
    raise SystemExit(main())
