import base64
import importlib
import io
import sys
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest
from convex import ConvexError
from flask import Blueprint, Flask

import user_file_vault as vault

USER_A = "00000000-0000-4000-8000-000000000001"
USER_B = "00000000-0000-4000-8000-000000000002"


@pytest.fixture
def files(tmp_path, monkeypatch):
    rows = {}
    client = Mock()

    def mutation(name, args):
        key = (args["user_id"], args["file_id"])
        if name == "vault:addFile":
            rows[key] = dict(args)
            return rows[key]
        if name == "vault:removeFile":
            rows.pop(key, None)

    def query(name, args):
        if name == "vault:getFile":
            return rows.get((args["user_id"], args["file_id"]))
        owned = [row for row in rows.values() if row["user_id"] == args["user_id"]]
        used = sum(row["size_bytes"] for row in owned)
        storage = {"used_bytes": used, "quota_bytes": vault.QUOTA_BYTES, "available_bytes": vault.QUOTA_BYTES - used,
                   "max_file_bytes": vault.MAX_FILE_BYTES, "file_count": len(owned)}
        if name == "vault:listFiles":
            return {"files": owned, "storage": storage}
        return storage

    client.mutation.side_effect = mutation
    client.query.side_effect = query
    def post(url, *, json, timeout):
        try:
            operation = client.mutation if url.endswith("/mutation") else client.query
            value = operation(json["path"], json["args"])
            payload = {"status": "success", "value": value}
        except ConvexError as error:
            payload = {"status": "error", "errorData": error.data}
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: payload)
    client.post.side_effect = post
    monkeypatch.setattr(vault, "_client", lambda: client)
    monkeypatch.setattr(vault.config, "USER_FILE_STORAGE_ROOT", str(tmp_path))
    return SimpleNamespace(root=tmp_path, rows=rows, client=client, mutation=mutation)


def upload(data=b"hello", **kwargs):
    return vault.upload_user_file(user_id=USER_A, file_name="report.txt", mime_type="text/plain", stream=io.BytesIO(data), **kwargs)


def test_files_are_private_and_names_never_control_paths(files):
    row = vault.upload_user_file(user_id=USER_A, file_name="../../日本語.txt", stream=io.BytesIO(b"hello"))
    metadata, path = vault.get_user_file_path(user_id=USER_A, file_id=row["id"])
    assert path == files.root / USER_A / row["id"]
    assert path.read_bytes() == b"hello"
    assert metadata["file_name"] == "日本語.txt"
    assert metadata["size_bytes"] == 5
    for operation in (vault.get_user_file, vault.delete_user_file, vault.read_user_file_text):
        with pytest.raises(vault.VaultError) as error:
            operation(user_id=USER_B, file_id=row["id"])
        assert error.value.status == 404
    assert path.exists()
    assert vault.list_user_files(user_id=USER_B) == []


def test_legacy_upload_uses_actual_size_not_client_size(files):
    row = vault.upload_user_file_from_base64(user_id=USER_A, file_name="a.txt", mime_type="text/plain",
                                           content_base64=base64.b64encode(b"real bytes").decode(), size_bytes=-1)
    assert row["size_bytes"] == 10
    with pytest.raises(vault.VaultError, match="Invalid file content"):
        vault.upload_user_file_from_base64(user_id=USER_A, file_name="a", mime_type=None, content_base64="%%%")


def test_file_limit_is_enforced_during_read_and_cleans_partial_file(files, monkeypatch):
    monkeypatch.setattr(vault, "MAX_FILE_BYTES", 3)
    assert upload(b"abc")["size_bytes"] == 3
    with pytest.raises(vault.VaultError) as error:
        upload(b"abcd")
    assert error.value.status == 413
    assert len(list(files.root.rglob("*.*"))) == 0
    assert len(list((files.root / USER_A).iterdir())) == 1


def test_quota_rejection_removes_new_bytes(files):
    files.client.mutation.side_effect = ConvexError("limit", "QUOTA_EXCEEDED")
    with pytest.raises(vault.VaultError) as error:
        upload()
    assert error.value.code == "QUOTA_EXCEEDED"
    assert error.value.status == 409
    assert list((files.root / USER_A).iterdir()) == []


def test_timeout_after_commit_keeps_the_confirmed_file(files):
    def committed_then_timeout(name, args):
        files.mutation(name, args)
        raise TimeoutError("response lost")

    files.client.mutation.side_effect = committed_then_timeout
    row = upload()
    assert (files.root / USER_A / row["id"]).read_bytes() == b"hello"
    assert vault.get_user_storage(user_id=USER_A)["used_bytes"] == 5


def test_failed_metadata_write_cleans_unregistered_bytes(files):
    files.client.mutation.side_effect = TimeoutError("no commit")
    with pytest.raises(vault.VaultError):
        upload()
    assert list((files.root / USER_A).iterdir()) == []


def test_disk_write_failure_cleans_partial_file(files, monkeypatch):
    def fail_rename(*args):
        raise OSError("No space left")
    monkeypatch.setattr(vault.os, "replace", fail_rename)
    with pytest.raises(vault.VaultError) as error:
        upload()
    assert error.value.status == 507
    assert list((files.root / USER_A).iterdir()) == []
    files.client.mutation.assert_not_called()


def test_failed_delete_can_be_retried_without_losing_accounting(files):
    row = upload()
    files.client.mutation.side_effect = TimeoutError("offline")
    with pytest.raises(vault.VaultError):
        vault.delete_user_file(user_id=USER_A, file_id=row["id"])
    assert vault.get_user_storage(user_id=USER_A)["used_bytes"] == 5
    files.client.mutation.side_effect = files.mutation
    assert vault.delete_user_file(user_id=USER_A, file_id=row["id"])["deleted"]
    assert vault.get_user_storage(user_id=USER_A)["used_bytes"] == 0


def test_preview_is_bounded_and_binary_is_not_text(files):
    row = upload(b"x" * 5000)
    result = vault.read_user_file_text(user_id=USER_A, file_id=row["id"], max_chars=200)
    assert len(result["content"]) == 200
    assert result["truncated"]
    binary = upload(b"a\x00b")
    assert vault.read_user_file_text(user_id=USER_A, file_id=binary["id"])["is_binary"]
    assert upload(b"")["size_bytes"] == 0


@pytest.fixture
def http(files, monkeypatch):
    auth = ModuleType("utils")
    auth.get_user_from_token = lambda request: (SimpleNamespace(id=request.headers.get("X-Test-User", USER_A)), None)
    monkeypatch.setitem(sys.modules, "utils", auth)
    sys.modules.pop("user_file_vault_api", None)
    routes = importlib.import_module("user_file_vault_api")
    app = Flask(__name__)
    app.testing = True
    parent = Blueprint("api", __name__, url_prefix="/api")
    parent.register_blueprint(routes.user_file_vault_bp)
    app.register_blueprint(parent)
    yield SimpleNamespace(client=app.test_client(), auth=auth)
    sys.modules.pop("user_file_vault_api", None)


def test_multipart_download_range_and_permanent_delete(http):
    response = http.client.post("/api/user-files/upload", data={"file": (io.BytesIO(b"hello world"), "test.html", "text/html")})
    assert response.status_code == 200
    file_id = response.json["file"]["id"]
    listing = http.client.get("/api/user-files")
    assert listing.json["storage"]["used_bytes"] == 11
    assert http.client.get(f"/api/user-files/{file_id}/download", headers={"X-Test-User": USER_B}).status_code == 404
    download = http.client.get(f"/api/user-files/{file_id}/download", headers={"Range": "bytes=0-4"})
    assert download.status_code == 206
    assert download.data == b"hello"
    assert download.headers["Content-Disposition"].startswith("attachment;")
    assert download.headers["Cache-Control"] == "private, no-store"
    download.close()
    assert http.client.delete(f"/api/user-files/{file_id}").status_code == 200
    assert http.client.get("/api/user-files/storage").json["storage"]["used_bytes"] == 0


def test_authentication_and_invalid_input(http, files):
    assert http.client.post("/api/user-files/upload", json={}).status_code == 400
    assert http.client.post("/api/user-files/upload", data={"file": [(io.BytesIO(b"a"), "a"), (io.BytesIO(b"b"), "b")]}).status_code == 400
    assert http.client.get("/api/user-files/not-a-uuid").status_code == 404
    http.auth.get_user_from_token = lambda request: (None, ("Unauthorized", 401))
    # The route imported the callable, so patch its boundary explicitly.
    module = sys.modules["user_file_vault_api"]
    module.get_user_from_token = http.auth.get_user_from_token
    assert http.client.post("/api/user-files/upload", data={"file": (io.BytesIO(b"x"), "a")}).status_code == 401
    assert list(files.root.iterdir()) == []
