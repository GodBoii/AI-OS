"""Private media files on the backend host with bounded, signed transfer URLs."""

import os
import re
import tempfile
from functools import lru_cache
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from itsdangerous import URLSafeTimedSerializer
from sqlalchemy import Column, Integer, MetaData, String, Table, insert, select
from sqlalchemy import delete

from agno_storage import get_engine, storage_root

MAX_BYTES = 50_000_000
MIME = re.compile(r"^[\w!#$&^.+-]+/[\w!#$&^.+-]+$")


@lru_cache(maxsize=1)
def media_table():
    metadata = MetaData()
    return Table("local_media", metadata, Column("path", String, primary_key=True),
        Column("mime_type", String, nullable=False), Column("size_bytes", Integer, nullable=False))


def safe_path(value: str) -> Path:
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Invalid media path.")
    logical = PurePosixPath(value)
    if logical.is_absolute() or ".." in logical.parts or str(logical) != value:
        raise ValueError("Invalid media path.")
    root = Path(os.getenv("MEDIA_STORAGE_ROOT", str(storage_root() / "media"))).resolve()
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = root.joinpath(*logical.parts)
    if not path.resolve().is_relative_to(root) or path.is_symlink():
        raise ValueError("Invalid media path.")
    return path


def signer() -> URLSafeTimedSerializer:
    secret = os.getenv("MEDIA_SIGNING_KEY")
    if not secret:
        raise RuntimeError("MEDIA_SIGNING_KEY is not configured.")
    return URLSafeTimedSerializer(secret, salt="aetheria-local-media-v1")


class LocalMediaStorage:
    def __init__(self):
        self.engine = get_engine()
        self.table = media_table()
        self.table.metadata.create_all(self.engine)

    def upload_stream(self, path: str, stream, mime_type: str) -> None:
        target = safe_path(path)
        if not MIME.fullmatch(mime_type) or len(mime_type) > 200:
            raise ValueError("Invalid media type.")
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        size = 0
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=target.parent, delete=False) as output:
                temporary = Path(output.name)
                os.chmod(temporary, 0o600)
                while chunk := stream.read(64 * 1024):
                    size += len(chunk)
                    if size > MAX_BYTES:
                        raise ValueError("Files must be 50 MB or smaller.")
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            with self.engine.begin() as connection:
                if connection.execute(select(self.table.c.path).where(self.table.c.path == path)).first():
                    raise FileExistsError("The upload link has already been used.")
                connection.execute(insert(self.table).values(path=path, mime_type=mime_type, size_bytes=size))
                os.replace(temporary, target)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)

    def upload(self, path: str, data: bytes, file_options=None):
        import io
        self.upload_stream(path, io.BytesIO(data), (file_options or {}).get("content-type", "application/octet-stream"))
        return {"path": path}

    def download(self, path: str) -> bytes:
        return safe_path(path).read_bytes()

    def metadata(self, path: str) -> dict | None:
        with self.engine.connect() as connection:
            row = connection.execute(select(self.table).where(self.table.c.path == path)).mappings().one_or_none()
        return dict(row) if row else None

    def remove(self, paths: list[str]) -> None:
        for path in paths:
            safe_path(path).unlink(missing_ok=True)
            with self.engine.begin() as connection:
                connection.execute(delete(self.table).where(self.table.c.path == path))

    def _url(self, path: str, action: str, expires_in: int) -> str:
        safe_path(path)
        duration = max(1, min(int(expires_in), 86400))
        token = signer().dumps({"path": path, "action": action, "duration": duration})
        base = os.getenv("BACKEND_PUBLIC_URL", "https://api.aetheriaai.website").rstrip("/")
        return f"{base}/api/media/{action}/{quote(token, safe='')}"

    def create_signed_url(self, path: str, expires_in: int = 3600) -> dict:
        url = self._url(path, "read", expires_in)
        return {"signedURL": url, "signed_url": url}

    def create_signed_upload_url(self, path: str) -> dict:
        url = self._url(path, "write", 600)
        return {"signedURL": url, "signed_url": url, "path": path}

    def get_public_url(self, path: str) -> str:
        # Compatibility for existing assistant clients. This remains a short-lived signed URL.
        return self.create_signed_url(path)["signed_url"]


@lru_cache(maxsize=1)
def media_storage() -> LocalMediaStorage:
    return LocalMediaStorage()


def verify_transfer(token: str, action: str) -> str:
    data = signer().loads(token, max_age=86400)
    if not isinstance(data, dict) or data.get("action") != action:
        raise ValueError("Invalid media transfer token.")
    signer().loads(token, max_age=int(data["duration"]))
    safe_path(data["path"])
    return data["path"]
