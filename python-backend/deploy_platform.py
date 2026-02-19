import base64
import hashlib
import json
import mimetypes
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Optional

import requests
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import create_engine, text

import config
from r2_client import get_r2_client


_TENANT_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$")
_DB_NAME_RE = re.compile(r"^[a-z0-9-]{3,64}$")
_RESERVED_SLUGS = {
    "www",
    "api",
    "app",
    "admin",
    "mail",
    "smtp",
    "imap",
    "pop",
    "ftp",
    "cdn",
    "status",
    "ns1",
    "ns2",
}


def _db_url_sqlalchemy() -> str:
    return config.DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)


_engine = create_engine(_db_url_sqlalchemy(), pool_pre_ping=True)


def _utc_now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


def _require_env(name: str) -> str:
    val = os.getenv(name)
    if not val:
        raise ValueError(f"Missing required environment variable: {name}")
    return val


def _fernet() -> Fernet:
    key = _require_env("DEPLOY_SECRET_KEY")
    try:
        return Fernet(key.encode("utf-8"))
    except Exception as exc:
        raise ValueError(
            "DEPLOY_SECRET_KEY must be a valid Fernet key. "
            "Generate with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
        ) from exc


def encrypt_secret(plain: str) -> str:
    return _fernet().encrypt(plain.encode("utf-8")).decode("utf-8")


def decrypt_secret(cipher: str) -> str:
    try:
        return _fernet().decrypt(cipher.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Unable to decrypt secret with DEPLOY_SECRET_KEY") from exc


def preflight_check() -> dict[str, Any]:
    required = [
        "DEPLOY_DOMAIN",
        "R2_SITES_BUCKET",
        "TURSO_ORG_SLUG",
        "TURSO_GROUP",
        "TURSO_API_TOKEN",
        "DEPLOY_SECRET_KEY",
        "R2_ENDPOINT",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
    ]
    missing = [k for k in required if not os.getenv(k)]

    checks = {
        "timestamp": _utc_now_iso(),
        "missing_env": missing,
        "database": False,
        "r2": False,
        "turso_token": False,
    }

    if missing:
        return {"ok": False, "checks": checks}

    with _engine.connect() as conn:
        conn.execute(text("select 1"))
    checks["database"] = True

    try:
        r2 = get_r2_client()
        r2.client.head_bucket(Bucket=os.getenv("R2_SITES_BUCKET"))
        checks["r2"] = True
    except Exception:
        checks["r2"] = False

    turso_base = "https://api.turso.tech/v1/auth/validate"
    resp = requests.get(
        turso_base,
        headers={"Authorization": f"Bearer {os.getenv('TURSO_API_TOKEN')}"},
        timeout=15,
    )
    checks["turso_token"] = resp.status_code == 200

    return {"ok": all([checks["database"], checks["r2"], checks["turso_token"]]), "checks": checks}


def ensure_deploy_tables() -> None:
    ddl = [
        """
        create table if not exists platform_sites (
          id uuid primary key,
          user_id uuid not null,
          project_name text not null,
          slug text not null unique,
          status text not null default 'draft',
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        );
        """,
        """
        create table if not exists platform_domains (
          id uuid primary key,
          site_id uuid not null references platform_sites(id) on delete cascade,
          hostname text not null unique,
          is_primary boolean not null default true,
          ssl_status text not null default 'active',
          created_at timestamptz not null default now()
        );
        """,
        """
        create table if not exists platform_deployments (
          id uuid primary key,
          site_id uuid not null references platform_sites(id) on delete cascade,
          version int not null,
          r2_prefix text not null,
          status text not null default 'queued',
          build_meta jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now(),
          activated_at timestamptz
        );
        """,
        """
        create unique index if not exists uniq_site_version
          on platform_deployments(site_id, version);
        """,
        """
        create table if not exists platform_site_databases (
          id uuid primary key,
          site_id uuid not null unique references platform_sites(id) on delete cascade,
          turso_org_slug text not null,
          turso_group text not null,
          turso_db_name text not null unique,
          turso_db_hostname text not null,
          encrypted_admin_token text not null,
          encrypted_rw_token text not null,
          encrypted_ro_token text,
          created_at timestamptz not null default now(),
          rotated_at timestamptz
        );
        """,
    ]
    with _engine.begin() as conn:
        for stmt in ddl:
            conn.execute(text(stmt))


def _validate_slug(slug: str) -> str:
    s = (slug or "").strip().lower()
    if not _TENANT_RE.fullmatch(s):
        raise ValueError("Invalid slug. Use lowercase letters, numbers, and dashes.")
    if s in _RESERVED_SLUGS:
        raise ValueError(f"Slug '{s}' is reserved")
    return s


def _ensure_site_owned(site_id: str, user_id: str) -> dict[str, Any]:
    with _engine.connect() as conn:
        row = conn.execute(
            text("select id, user_id, slug, status from platform_sites where id = :site_id"),
            {"site_id": site_id},
        ).mappings().first()
    if not row:
        raise ValueError("Site not found")
    if str(row["user_id"]) != str(user_id):
        raise PermissionError("Unauthorized site access")
    return dict(row)


def create_or_get_site(site_id: str, user_id: str, project_name: str, slug: str) -> dict[str, Any]:
    safe_slug = _validate_slug(slug)
    with _engine.begin() as conn:
        existing = conn.execute(
            text("select id, user_id, slug, status from platform_sites where id = :site_id"),
            {"site_id": site_id},
        ).mappings().first()
        if existing:
            if str(existing["user_id"]) != str(user_id):
                raise PermissionError("Unauthorized site access")
            return dict(existing)

        conn.execute(
            text(
                """
                insert into platform_sites (id, user_id, project_name, slug, status)
                values (:id, :user_id, :project_name, :slug, 'draft')
                """
            ),
            {
                "id": site_id,
                "user_id": user_id,
                "project_name": project_name,
                "slug": safe_slug,
            },
        )
    return {"id": site_id, "user_id": user_id, "slug": safe_slug, "status": "draft"}


def assign_subdomain(site_id: str, user_id: str) -> dict[str, Any]:
    site = _ensure_site_owned(site_id=site_id, user_id=user_id)
    deploy_domain = _require_env("DEPLOY_DOMAIN").lower()
    hostname = f"{site['slug']}.{deploy_domain}"

    with _engine.begin() as conn:
        conn.execute(
            text(
                """
                insert into platform_domains (id, site_id, hostname, is_primary, ssl_status)
                values (:id, :site_id, :hostname, true, 'active')
                on conflict (hostname) do update set site_id = excluded.site_id
                """
            ),
            {"id": str(uuid.uuid4()), "site_id": site_id, "hostname": hostname},
        )
    return {"site_id": site_id, "hostname": hostname}


def _sanitize_path(path: str) -> str:
    p = (path or "").strip().replace("\\", "/")
    p = p.lstrip("/")
    if not p or p.endswith("/"):
        raise ValueError("Invalid file path")
    if ".." in p.split("/"):
        raise ValueError("Invalid file path")
    return p


def _next_deployment_version(site_id: str) -> int:
    with _engine.connect() as conn:
        row = conn.execute(
            text("select coalesce(max(version), 0) as v from platform_deployments where site_id = :site_id"),
            {"site_id": site_id},
        ).mappings().first()
    return int(row["v"]) + 1


@dataclass
class UploadResult:
    deployment_id: str
    version: int
    r2_prefix: str
    files_uploaded: int


def upload_site_files(site_id: str, user_id: str, files: list[dict[str, Any]]) -> UploadResult:
    site = _ensure_site_owned(site_id=site_id, user_id=user_id)
    if not files:
        raise ValueError("No files provided")

    version = _next_deployment_version(site_id)
    deployment_id = str(uuid.uuid4())
    prefix = f"sites/{site_id}/deployments/{deployment_id}"
    bucket = _require_env("R2_SITES_BUCKET")

    r2 = get_r2_client()
    uploaded = 0
    for item in files:
        path = _sanitize_path(str(item.get("path", "")))
        content_type = item.get("content_type") or mimetypes.guess_type(path)[0] or "application/octet-stream"

        if "content_base64" in item and item["content_base64"] is not None:
            content_bytes = base64.b64decode(item["content_base64"])
        elif "content" in item and item["content"] is not None:
            content_bytes = str(item["content"]).encode("utf-8")
        else:
            raise ValueError(f"File '{path}' missing content")

        key = f"{prefix}/{path}"
        r2.client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content_bytes,
            ContentType=content_type,
            Metadata={"site-id": site_id, "deployment-id": deployment_id, "slug": site["slug"]},
        )
        uploaded += 1

    with _engine.begin() as conn:
        conn.execute(
            text(
                """
                insert into platform_deployments (id, site_id, version, r2_prefix, status, build_meta)
                values (:id, :site_id, :version, :r2_prefix, 'uploading', cast(:build_meta as jsonb))
                """
            ),
            {
                "id": deployment_id,
                "site_id": site_id,
                "version": version,
                "r2_prefix": prefix,
                "build_meta": json.dumps({"uploaded_files": uploaded}),
            },
        )

    return UploadResult(
        deployment_id=deployment_id,
        version=version,
        r2_prefix=prefix,
        files_uploaded=uploaded,
    )


def _safe_db_name(site_id: str) -> str:
    raw = f"site-{site_id}".lower().replace("_", "-")
    cleaned = re.sub(r"[^a-z0-9-]", "-", raw)
    compact = re.sub(r"-{2,}", "-", cleaned).strip("-")
    if len(compact) > 52:
        compact = compact[:52].rstrip("-")
    suffix = uuid.uuid4().hex[:8]
    name = f"{compact}-{suffix}"
    if not _DB_NAME_RE.fullmatch(name):
        raise ValueError("Generated Turso database name is invalid")
    return name


def provision_turso_database(site_id: str, user_id: str) -> dict[str, Any]:
    _ensure_site_owned(site_id=site_id, user_id=user_id)
    org_slug = _require_env("TURSO_ORG_SLUG")
    group = _require_env("TURSO_GROUP")
    api_token = _require_env("TURSO_API_TOKEN")

    with _engine.connect() as conn:
        existing = conn.execute(
            text(
                """
                select turso_db_name, turso_db_hostname
                from platform_site_databases
                where site_id = :site_id
                """
            ),
            {"site_id": site_id},
        ).mappings().first()
    if existing:
        return {
            "site_id": site_id,
            "database_name": existing["turso_db_name"],
            "hostname": existing["turso_db_hostname"],
            "already_exists": True,
        }

    db_name = _safe_db_name(site_id)
    base = f"https://api.turso.tech/v1/organizations/{org_slug}/databases"
    headers = {"Authorization": f"Bearer {api_token}", "Content-Type": "application/json"}

    create_resp = requests.post(base, headers=headers, json={"name": db_name, "group": group}, timeout=30)
    if create_resp.status_code not in (200, 201):
        raise RuntimeError(f"Turso create database failed: {create_resp.status_code} {create_resp.text}")

    db_obj = (create_resp.json() or {}).get("database") or {}
    hostname = db_obj.get("Hostname") or f"{db_name}-{org_slug}.turso.io"

    rw_url = f"{base}/{db_name}/auth/tokens?authorization=full-access&expiration=90d"
    ro_url = f"{base}/{db_name}/auth/tokens?authorization=read-only&expiration=90d"
    admin_url = f"{base}/{db_name}/auth/tokens?authorization=full-access&expiration=365d"

    rw_resp = requests.post(rw_url, headers=headers, timeout=30)
    ro_resp = requests.post(ro_url, headers=headers, timeout=30)
    admin_resp = requests.post(admin_url, headers=headers, timeout=30)
    for resp, label in [(rw_resp, "rw"), (ro_resp, "ro"), (admin_resp, "admin")]:
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"Turso create {label} token failed: {resp.status_code} {resp.text}")

    rw_token = rw_resp.json().get("jwt")
    ro_token = ro_resp.json().get("jwt")
    admin_token = admin_resp.json().get("jwt")
    if not rw_token or not ro_token or not admin_token:
        raise RuntimeError("Turso token generation returned an empty token")

    with _engine.begin() as conn:
        conn.execute(
            text(
                """
                insert into platform_site_databases (
                  id, site_id, turso_org_slug, turso_group, turso_db_name, turso_db_hostname,
                  encrypted_admin_token, encrypted_rw_token, encrypted_ro_token
                )
                values (
                  :id, :site_id, :org_slug, :group, :db_name, :db_hostname,
                  :admin_token, :rw_token, :ro_token
                )
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "site_id": site_id,
                "org_slug": org_slug,
                "group": group,
                "db_name": db_name,
                "db_hostname": hostname,
                "admin_token": encrypt_secret(admin_token),
                "rw_token": encrypt_secret(rw_token),
                "ro_token": encrypt_secret(ro_token),
            },
        )

    return {"site_id": site_id, "database_name": db_name, "hostname": hostname, "already_exists": False}


def get_site_db_credentials(site_id: str, user_id: str, include_admin: bool = False) -> dict[str, Any]:
    _ensure_site_owned(site_id=site_id, user_id=user_id)
    with _engine.connect() as conn:
        row = conn.execute(
            text(
                """
                select turso_db_name, turso_db_hostname, encrypted_rw_token, encrypted_ro_token, encrypted_admin_token
                from platform_site_databases
                where site_id = :site_id
                """
            ),
            {"site_id": site_id},
        ).mappings().first()
    if not row:
        raise ValueError("No database provisioned for this site")

    out = {
        "database_name": row["turso_db_name"],
        "hostname": row["turso_db_hostname"],
        "url": f"libsql://{row['turso_db_hostname']}",
        "rw_token": decrypt_secret(row["encrypted_rw_token"]),
        "ro_token": decrypt_secret(row["encrypted_ro_token"]) if row.get("encrypted_ro_token") else None,
    }
    if include_admin:
        out["admin_token"] = decrypt_secret(row["encrypted_admin_token"])
    return out


def activate_deployment(site_id: str, user_id: str, deployment_id: str) -> dict[str, Any]:
    _ensure_site_owned(site_id=site_id, user_id=user_id)
    with _engine.begin() as conn:
        dep = conn.execute(
            text(
                """
                select id, site_id, r2_prefix
                from platform_deployments
                where id = :deployment_id and site_id = :site_id
                """
            ),
            {"deployment_id": deployment_id, "site_id": site_id},
        ).mappings().first()
        if not dep:
            raise ValueError("Deployment not found")

        conn.execute(
            text(
                """
                update platform_deployments
                set status = 'active', activated_at = now()
                where id = :deployment_id
                """
            ),
            {"deployment_id": deployment_id},
        )
        conn.execute(
            text("update platform_sites set status = 'active', updated_at = now() where id = :site_id"),
            {"site_id": site_id},
        )

        host_row = conn.execute(
            text("select hostname from platform_domains where site_id = :site_id and is_primary = true"),
            {"site_id": site_id},
        ).mappings().first()

    if not host_row:
        host = assign_subdomain(site_id=site_id, user_id=user_id)["hostname"]
    else:
        host = host_row["hostname"]

    return {"site_id": site_id, "deployment_id": deployment_id, "url": f"https://{host}", "active": True}


def upsert_site_manifest(site_id: str, user_id: str, deployment_id: str) -> dict[str, Any]:
    site = _ensure_site_owned(site_id=site_id, user_id=user_id)
    creds: Optional[dict[str, Any]] = None
    try:
        creds = get_site_db_credentials(site_id=site_id, user_id=user_id, include_admin=False)
    except ValueError:
        # Phase-gated deploy: allow static-only deploys without a provisioned DB.
        creds = None
    with _engine.connect() as conn:
        dep = conn.execute(
            text("select r2_prefix from platform_deployments where id = :id and site_id = :site_id"),
            {"id": deployment_id, "site_id": site_id},
        ).mappings().first()
    if not dep:
        raise ValueError("Deployment not found")

    manifest = {
        "site_id": site_id,
        "slug": site["slug"],
        "deployment_id": deployment_id,
        "r2_prefix": dep["r2_prefix"],
        "db": (
            {
                "url": creds["url"],
                "rw_token": creds["rw_token"],
                "ro_token": creds["ro_token"],
                "hostname": creds["hostname"],
                "database_name": creds["database_name"],
            }
            if creds
            else None
        ),
        "updated_at": _utc_now_iso(),
    }

    bucket = _require_env("R2_SITES_BUCKET")
    key = f"manifests/{site['slug']}.json"
    body = json.dumps(manifest, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    etag = hashlib.sha256(body).hexdigest()
    r2 = get_r2_client()
    r2.client.put_object(
        Bucket=bucket,
        Key=key,
        Body=body,
        ContentType="application/json",
        Metadata={"site-id": site_id, "deployment-id": deployment_id, "sha256": etag},
    )
    return {"manifest_key": key, "sha256": etag}
