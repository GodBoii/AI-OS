import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import text


@pytest.fixture
def platform(tmp_path, monkeypatch):
    database = ModuleType("database_config")
    database.get_sqlalchemy_database_url = lambda: f"sqlite:///{(tmp_path / 'platform.db').as_posix()}"
    storage = ModuleType("r2_client")
    r2 = SimpleNamespace(client=Mock())
    storage.get_r2_client = lambda: r2
    monkeypatch.setitem(sys.modules, "database_config", database)
    monkeypatch.setitem(sys.modules, "r2_client", storage)
    spec = importlib.util.spec_from_file_location("vault_test_deploy", Path(__file__).parents[1] / "deploy_platform.py")
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    with module._engine.begin() as conn:
        conn.execute(text("create table platform_sites (id text, user_id text, project_name text, slug text, status text, created_at text, updated_at text)"))
        conn.execute(text("create table platform_domains (site_id text, hostname text, is_primary boolean)"))
        conn.execute(text("create table platform_deployments (id text, site_id text, status text, version integer, r2_prefix text, created_at text, activated_at text)"))
        conn.execute(text("insert into platform_sites values ('site-a', 'user-a', 'Demo', 'demo', 'active', '2026-10-06', '2026-10-06')"))
        conn.execute(text("insert into platform_domains values ('site-a', 'demo.example.com', true)"))
        conn.execute(text("insert into platform_deployments values ('deployment-a', 'site-a', 'active', 1, 'sites/demo/1/', '2026-10-06', '2026-10-06')"))
    for key in ["DEPLOY_DOMAIN", "R2_SITES_BUCKET", "R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]:
        monkeypatch.setenv(key, "test-value")
    yield SimpleNamespace(module=module, r2=r2)
    module._engine.dispose()


def test_website_listing_and_history_need_no_site_database_table(platform):
    sites = platform.module.list_user_sites("user-a")
    assert len(sites) == 1
    assert sites[0]["hostname"] == "demo.example.com"
    assert sites[0]["database_name"] is None
    projects = platform.module.list_deployed_projects("user-a")
    assert projects[0]["deployments"][0]["r2_prefix"] == "sites/demo/1/"
    assert platform.module.list_user_sites("user-b") == []


def test_manifest_keeps_r2_routing_and_ownership(platform):
    result = platform.module.upsert_site_manifest("site-a", "user-a", "deployment-a")
    assert result["manifest_key"] == "manifests/demo.json"
    call = platform.r2.client.put_object.call_args.kwargs
    manifest = json.loads(call["Body"])
    assert manifest["db"] is None
    assert manifest["r2_prefix"] == "sites/demo/1/"
    with pytest.raises(PermissionError):
        platform.module.upsert_site_manifest("site-a", "user-b", "deployment-a")


def test_preflight_checks_platform_database_and_r2(platform):
    result = platform.module.preflight_check()
    assert result["ok"]
    assert result["checks"]["database"]
    assert result["checks"]["r2"]
    platform.r2.client.head_bucket.assert_called_once_with(Bucket="test-value")
