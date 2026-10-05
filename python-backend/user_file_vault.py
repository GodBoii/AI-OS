import base64
import hashlib
import io
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, BinaryIO, Literal

import config
import requests

logger = logging.getLogger(__name__)
MAX_FILE_BYTES = 50_000_000
QUOTA_BYTES = 500_000_000
_MIME_TYPE = re.compile(r"^[\w!#$&^.+-]+/[\w!#$&^.+-]+$", re.ASCII)


class VaultError(Exception):
    def __init__(self, message: str, *, status: int = 503, code: str = "STORAGE_UNAVAILABLE"):
        super().__init__(message)
        self.status = status
        self.code = code


@lru_cache(maxsize=1)
def _client() -> requests.Session:
    if not config.CONVEX_URL or not config.CONVEX_ADMIN_KEY:
        raise VaultError("File storage is not configured")
    client = requests.Session()
    client.headers["Authorization"] = f"Convex {config.CONVEX_ADMIN_KEY}"
    return client


def _request(kind: Literal["query", "mutation"], name: str, args: dict[str, Any]) -> Any:
    try:
        response = _client().post(
            f"{config.CONVEX_URL.rstrip('/')}/api/{kind}",
            json={"path": f"vault:{name}", "args": args, "format": "json"},
            timeout=(5, 20),
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise VaultError("Invalid file storage response")
        if payload.get("status") == "success" and "value" in payload:
            return payload["value"]
        code = payload.get("errorData")
        if code == "QUOTA_EXCEEDED":
            raise VaultError("Your 500 MB storage limit has been reached", status=409, code=code)
        if code == "FILE_TOO_LARGE":
            raise VaultError("Each file must be 50 MB or smaller", status=413, code=code)
        logger.error("Vault metadata operation failed: %s %s", kind, name)
        raise VaultError("File storage is temporarily unavailable")
    except VaultError:
        raise
    except Exception as exc:
        logger.exception("Vault metadata request failed: %s %s", kind, name)
        raise VaultError("File storage is temporarily unavailable") from exc


def _uuid(value: str) -> str:
    try:
        return str(uuid.UUID(str(value)))
    except (ValueError, TypeError, AttributeError) as exc:
        raise VaultError("File not found", status=404, code="FILE_NOT_FOUND") from exc


def _root() -> Path:
    return Path(config.USER_FILE_STORAGE_ROOT).resolve()


def _path(user_id: str, file_id: str) -> Path:
    root = _root()
    path = root / _uuid(user_id) / _uuid(file_id)
    if not path.resolve().is_relative_to(root) or path.is_symlink() or path.parent.is_symlink():
        raise VaultError("Invalid file path", status=403, code="INVALID_PATH")
    return path


def _filename(value: str) -> str:
    if not isinstance(value, str):
        raise VaultError("A file name is required", status=400, code="INVALID_FILE")
    name = str(value or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    name = "".join(char for char in name if ord(char) >= 32 and ord(char) != 127)
    if not name or name in {".", ".."}:
        raise VaultError("A file name is required", status=400, code="INVALID_FILE")
    return name[:180]


def _metadata(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["file_id"], "user_id": row["user_id"],
        "storage_bucket": "local", "storage_path": row["storage_path"],
        "file_name": row["file_name"], "mime_type": row["mime_type"],
        "size_bytes": row["size_bytes"], "tags": row["tags"],
        "created_at": row["created_at"], "sha256": row["sha256"], "download_url": None,
    }


def upload_user_file(
    *, user_id: str, file_name: str, stream: BinaryIO,
    mime_type: str | None = None, tags: list[str] | None = None,
) -> dict[str, Any]:
    user_id = _uuid(user_id)
    name = _filename(file_name)
    content_type = mime_type or "application/octet-stream"
    if not isinstance(content_type, str) or not _MIME_TYPE.fullmatch(content_type):
        raise VaultError("Invalid file type", status=400, code="INVALID_FILE")
    if tags is not None and (not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags)):
        raise VaultError("Tags must be an array of strings", status=400, code="INVALID_FILE")
    _client()
    file_id = str(uuid.uuid4())
    path = _path(user_id, file_id)
    temporary = path.with_suffix(".tmp")
    size = 0
    digest = hashlib.sha256()
    try:
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with temporary.open("xb") as output:
            os.chmod(temporary, 0o600)
            while chunk := stream.read(64 * 1024):
                size += len(chunk)
                if size > MAX_FILE_BYTES:
                    raise VaultError("Each file must be 50 MB or smaller", status=413, code="FILE_TOO_LARGE")
                output.write(chunk)
                digest.update(chunk)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    except (OSError, VaultError) as exc:
        temporary.unlink(missing_ok=True)
        if isinstance(exc, VaultError):
            raise
        logger.exception("Vault file write failed for user %s", user_id)
        raise VaultError("Could not save the file", status=507, code="DISK_WRITE_FAILED") from exc

    row = {
        "file_id": file_id, "user_id": user_id,
        "storage_path": f"{user_id}/{file_id}", "file_name": name,
        "mime_type": content_type, "size_bytes": size, "sha256": digest.hexdigest(),
        "tags": [tag.strip()[:100] for tag in (tags or []) if tag.strip()][:20],
        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    try:
        _request("mutation", "addFile", row)
    except VaultError as exc:
        if exc.code in {"QUOTA_EXCEEDED", "FILE_TOO_LARGE"}:
            path.unlink(missing_ok=True)
            raise
        # A timed-out mutation may have committed. Never remove its file blindly.
        existing = _request("query", "getFile", {"user_id": user_id, "file_id": file_id})
        if not existing:
            path.unlink(missing_ok=True)
            raise exc
        if existing["sha256"] != row["sha256"]:
            raise exc
    return _metadata(row)


def upload_user_file_from_base64(
    *, user_id: str, file_name: str, mime_type: str | None,
    content_base64: str, size_bytes: int | None = None, tags: list[str] | None = None,
) -> dict[str, Any]:
    # Support installed desktop clients during the switch to multipart uploads.
    if len(content_base64) > ((MAX_FILE_BYTES + 2) // 3) * 4:
        raise VaultError("Each file must be 50 MB or smaller", status=413, code="FILE_TOO_LARGE")
    try:
        data = base64.b64decode(content_base64, validate=True)
    except (ValueError, TypeError) as exc:
        raise VaultError("Invalid file content", status=400, code="INVALID_FILE") from exc
    return upload_user_file(user_id=user_id, file_name=file_name, mime_type=mime_type, stream=io.BytesIO(data), tags=tags)


def list_user_file_page(
    *, user_id: str, limit: int = 100, search: str = "", file_type: str = "all",
) -> dict[str, Any]:
    result = _request("query", "listFiles", {
        "user_id": _uuid(user_id), "limit": max(1, min(int(limit), 500)),
        "search": str(search).strip()[:200], "file_type": str(file_type or "all").lower(),
    })
    return {"files": [_metadata(row) for row in result["files"]], "storage": result["storage"]}


def list_user_files(
    *, user_id: str, limit: int = 100, search: str = "", file_type: str = "all", signed_url_expiry: int = 3600,
) -> list[dict[str, Any]]:
    return list_user_file_page(user_id=user_id, limit=limit, search=search, file_type=file_type)["files"]


def get_user_storage(*, user_id: str) -> dict[str, int]:
    return _request("query", "getStorage", {"user_id": _uuid(user_id)})


def get_user_file(
    *, user_id: str, file_id: str, include_signed_url: bool = True, signed_url_expiry: int = 3600,
) -> dict[str, Any]:
    row = _request("query", "getFile", {"user_id": _uuid(user_id), "file_id": _uuid(file_id)})
    if not row:
        raise VaultError("File not found", status=404, code="FILE_NOT_FOUND")
    return _metadata(row)


def get_user_file_path(*, user_id: str, file_id: str) -> tuple[dict[str, Any], Path]:
    row = get_user_file(user_id=user_id, file_id=file_id)
    path = _path(user_id, file_id)
    if not path.is_file():
        raise VaultError("File not found", status=404, code="FILE_NOT_FOUND")
    return row, path


def delete_user_file(*, user_id: str, file_id: str) -> dict[str, Any]:
    row = get_user_file(user_id=user_id, file_id=file_id)
    try:
        _path(user_id, file_id).unlink(missing_ok=True)
    except OSError as exc:
        logger.exception("Vault file delete failed: %s", file_id)
        raise VaultError("Could not delete the file") from exc
    # Keep charging the bytes until metadata removal succeeds; retries are safe.
    _request("mutation", "removeFile", {"user_id": _uuid(user_id), "file_id": _uuid(file_id)})
    return {"deleted": True, "id": row["id"], "file_name": row["file_name"], "storage_path": row["storage_path"]}


def read_user_file_text(*, user_id: str, file_id: str, max_chars: int = 40000) -> dict[str, Any]:
    row, path = get_user_file_path(user_id=user_id, file_id=file_id)
    limit = max(200, min(int(max_chars), 200000))
    with path.open("rb") as source:
        data = source.read(limit * 4 + 4)
    binary = b"\x00" in data
    text = data.decode("utf-8", errors="replace") if not binary else ""
    return {
        **row, "is_binary": binary, "content": None if binary else text[:limit],
        "truncated": not binary and (len(text) > limit or row["size_bytes"] > len(data)),
    }
