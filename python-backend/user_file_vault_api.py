import logging

from flask import Blueprint, g, jsonify, request, send_file
from werkzeug.exceptions import RequestEntityTooLarge

from user_file_vault import (
    MAX_FILE_BYTES,
    VaultError,
    delete_user_file,
    get_user_file,
    get_user_file_path,
    get_user_storage,
    list_user_file_page,
    read_user_file_text,
    upload_user_file,
    upload_user_file_from_base64,
)
from utils import get_user_from_token

logger = logging.getLogger(__name__)
user_file_vault_bp = Blueprint("user_file_vault", __name__)


@user_file_vault_bp.before_request
def authenticate():
    user, error = get_user_from_token(request)
    if error:
        return jsonify({"ok": False, "error": error[0]}), error[1]
    g.vault_user_id = str(user.id)
    if request.method == "POST":
        # JSON is retained for installed clients; new clients send multipart bytes.
        payload_limit = ((MAX_FILE_BYTES + 2) // 3) * 4 if request.is_json else MAX_FILE_BYTES
        request.max_content_length = payload_limit + 64 * 1024
        request.max_form_parts = 5
        if request.content_length and request.content_length > request.max_content_length:
            raise RequestEntityTooLarge()


@user_file_vault_bp.errorhandler(VaultError)
def vault_error(error):
    return jsonify({"ok": False, "error": str(error), "code": error.code}), error.status


@user_file_vault_bp.errorhandler(RequestEntityTooLarge)
def oversized_request(_error):
    return jsonify({"ok": False, "error": "Each file must be 50 MB or smaller", "code": "FILE_TOO_LARGE"}), 413


@user_file_vault_bp.errorhandler(FileNotFoundError)
def missing_file(_error):
    return jsonify({"ok": False, "error": "File not found", "code": "FILE_NOT_FOUND"}), 404


@user_file_vault_bp.errorhandler(OSError)
def disk_error(error):
    logger.error("Vault disk operation failed", exc_info=error)
    return jsonify({"ok": False, "error": "File storage is temporarily unavailable", "code": "DISK_UNAVAILABLE"}), 503


@user_file_vault_bp.route("/user-files/upload", methods=["POST"])
def upload():
    if request.is_json:
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get("contentBase64"), str):
            raise VaultError("File content is required", status=400, code="INVALID_FILE")
        row = upload_user_file_from_base64(
            user_id=g.vault_user_id, file_name=body.get("fileName"),
            mime_type=body.get("mimeType"), content_base64=body["contentBase64"], tags=body.get("tags"),
        )
    else:
        files = request.files.getlist("file")
        if len(files) != 1 or len(request.files) != 1:
            raise VaultError("Upload one file per request", status=400, code="INVALID_FILE")
        file = files[0]
        row = upload_user_file(
            user_id=g.vault_user_id, file_name=file.filename,
            mime_type=file.mimetype, stream=file.stream,
        )
    return jsonify({"ok": True, "file": row})


@user_file_vault_bp.route("/user-files", methods=["GET"])
def list_files():
    page = list_user_file_page(
        user_id=g.vault_user_id, limit=request.args.get("limit", default=100, type=int) or 100,
        search=request.args.get("search", ""), file_type=request.args.get("file_type", "all"),
    )
    return jsonify({"ok": True, **page, "count": len(page["files"])})


@user_file_vault_bp.route("/user-files/storage", methods=["GET"])
def storage():
    return jsonify({"ok": True, "storage": get_user_storage(user_id=g.vault_user_id)})


@user_file_vault_bp.route("/user-files/<file_id>", methods=["GET"])
def details(file_id):
    return jsonify({"ok": True, "file": get_user_file(user_id=g.vault_user_id, file_id=file_id)})


@user_file_vault_bp.route("/user-files/<file_id>/content", methods=["GET"])
def content(file_id):
    row = read_user_file_text(
        user_id=g.vault_user_id, file_id=file_id,
        max_chars=request.args.get("max_chars", default=40000, type=int) or 40000,
    )
    return jsonify({"ok": True, "file": row})


@user_file_vault_bp.route("/user-files/<file_id>/download", methods=["GET"])
def download(file_id):
    row, path = get_user_file_path(user_id=g.vault_user_id, file_id=file_id)
    response = send_file(
        path, mimetype=row["mime_type"], download_name=row["file_name"],
        as_attachment=True, conditional=True, etag=row["sha256"], max_age=0,
    )
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@user_file_vault_bp.route("/user-files/<file_id>", methods=["DELETE"])
def delete(file_id):
    return jsonify({"ok": True, **delete_user_file(user_id=g.vault_user_id, file_id=file_id)})
