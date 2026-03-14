import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import requests

import config
from convex_usage_service import get_convex_usage_service
from supabase_client import supabase_client

logger = logging.getLogger(__name__)

RAZORPAY_API_BASE = "https://api.razorpay.com/v1"
PAID_PLAN_TYPES = {"pro", "elite"}
ACCESS_ACTIVE_STATUSES = {"active", "authenticated", "resumed"}
ACCESS_WINDOW_STATUSES = {"cancelled", "paused", "pending"}
TERMINAL_STATUSES = {"completed", "expired", "halted"}


PLAN_CATALOG: dict[str, dict[str, Any]] = {
    "free": {
        "type": "free",
        "name": "Core",
        "price_inr": 0,
        "limit_tokens": 50_000,
        "interval_label": "day",
        "description": "Entry tier with a daily token budget.",
        "cta_label": "Included",
        "accent": "core",
    },
    "pro": {
        "type": "pro",
        "name": "Pro",
        "price_inr": 428,
        "limit_tokens": 5_000_000,
        "interval_label": "month",
        "description": "Monthly plan for regular heavy usage.",
        "cta_label": "Upgrade to Pro",
        "accent": "pro",
    },
    "elite": {
        "type": "elite",
        "name": "Elite",
        "price_inr": 4_428,
        "limit_tokens": 50_000_000,
        "interval_label": "month",
        "description": "Highest monthly allowance for intensive workflows.",
        "cta_label": "Upgrade to Elite",
        "accent": "elite",
    },
}


class UsageLimitExceeded(Exception):
    def __init__(self, summary: dict[str, Any]):
        self.summary = summary
        super().__init__(format_limit_message(summary))


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _to_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _dt_to_iso(value: Optional[datetime]) -> Optional[str]:
    if not value:
        return None
    normalized = value.astimezone(timezone.utc)
    return normalized.isoformat()


def _unix_to_dt(value: Any) -> Optional[datetime]:
    try:
        if value in (None, ""):
            return None
        return datetime.fromtimestamp(int(value), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def _next_utc_day_boundary(now: Optional[datetime] = None) -> datetime:
    current = now or _utc_now()
    midnight = datetime(
        year=current.year,
        month=current.month,
        day=current.day,
        tzinfo=timezone.utc,
    )
    return midnight + timedelta(days=1)


def _utc_day_start(now: Optional[datetime] = None) -> datetime:
    current = now or _utc_now()
    return datetime(
        year=current.year,
        month=current.month,
        day=current.day,
        tzinfo=timezone.utc,
    )


def _resolve_usage_window_from_profile(profile: dict[str, Any], now: Optional[datetime] = None) -> dict[str, Any]:
    current = now or _utc_now()
    plan_type = str(profile.get("plan_type") or "free").strip().lower()
    status = str(profile.get("subscription_status") or "none").strip().lower()
    current_period_end = _parse_dt(profile.get("current_period_end"))
    day_key = current.astimezone(timezone.utc).strftime("%Y-%m-%d")

    if (
        plan_type in PAID_PLAN_TYPES
        and _status_grants_paid_access(status, current_period_end)
    ):
        if current_period_end and current_period_end > current:
            window_key = f"{plan_type}:{int(current_period_end.timestamp())}"
            return {
                "plan_type": plan_type,
                "subscription_status": status,
                "limit_interval": "month",
                "day_key": day_key,
                "window_key": window_key,
                "window_start": None,
                "window_end": current_period_end,
            }

        month_start = datetime(year=current.year, month=current.month, day=1, tzinfo=timezone.utc)
        if current.month == 12:
            month_end = datetime(year=current.year + 1, month=1, day=1, tzinfo=timezone.utc)
        else:
            month_end = datetime(year=current.year, month=current.month + 1, day=1, tzinfo=timezone.utc)
        return {
            "plan_type": plan_type,
            "subscription_status": status,
            "limit_interval": "month",
            "day_key": day_key,
            "window_key": f"{plan_type}:calendar:{month_start.strftime('%Y-%m')}",
            "window_start": month_start,
            "window_end": month_end,
        }

    window_start = _utc_day_start(current)
    window_end = _next_utc_day_boundary(current)
    return {
        "plan_type": "free",
        "subscription_status": "none" if plan_type == "free" else status,
        "limit_interval": "day",
        "day_key": day_key,
        "window_key": f"free:{window_start.strftime('%Y-%m-%d')}",
        "window_start": window_start,
        "window_end": window_end,
    }


def _extract_response_data(response: Any, default: Any) -> Any:
    """
    The Supabase client can return `None` from execute() in transient edge-cases.
    Normalize that so callers don't crash on `response.data`.
    """
    if response is None:
        return default
    return getattr(response, "data", default)


def get_plan_catalog() -> list[dict[str, Any]]:
    plans: list[dict[str, Any]] = []
    for key in ("free", "pro", "elite"):
        plan = dict(PLAN_CATALOG[key])
        plan["token_limit_label"] = format_token_limit(plan["limit_tokens"], plan["interval_label"])
        plans.append(plan)
    return plans


def get_plan_config(plan_type: Optional[str]) -> dict[str, Any]:
    key = str(plan_type or "free").strip().lower()
    return PLAN_CATALOG.get(key, PLAN_CATALOG["free"])


def get_plan_id_for_type(plan_type: str) -> Optional[str]:
    normalized = str(plan_type or "").strip().lower()
    if normalized == "pro":
        return config.PRO_PLAN_ID
    if normalized == "elite":
        return config.ELITE_PLAN_ID
    return None


def resolve_plan_type_from_plan_id(plan_id: Optional[str]) -> Optional[str]:
    if not plan_id:
        return None
    if config.PRO_PLAN_ID and str(plan_id) == str(config.PRO_PLAN_ID):
        return "pro"
    if config.ELITE_PLAN_ID and str(plan_id) == str(config.ELITE_PLAN_ID):
        return "elite"
    return None


def format_token_limit(limit_tokens: int, interval_label: str) -> str:
    return f"{int(limit_tokens):,} tokens/{interval_label}"


def _extract_error_message(response: requests.Response) -> str:
    try:
        payload = response.json() or {}
    except ValueError:
        payload = {}

    error_payload = payload.get("error") if isinstance(payload, dict) else None
    if isinstance(error_payload, dict):
        description = error_payload.get("description") or error_payload.get("reason")
        code = error_payload.get("code")
        if description and code:
            return f"{description} ({code})"
        if description:
            return str(description)
    if isinstance(payload, dict) and payload.get("description"):
        return str(payload["description"])
    body = (response.text or "").strip()
    return body or f"HTTP {response.status_code}"


def _razorpay_auth_available() -> bool:
    return bool(config.RAZORPAY_KEY_ID and config.RAZORPAY_KEY_SECRET)


def get_profile(user_id: str) -> dict[str, Any]:
    response = (
        supabase_client
        .from_("profiles")
        .select(
            "id,email,name,plan_type,subscription_status,"
            "razorpay_customer_id,razorpay_subscription_id,current_period_end"
        )
        .eq("id", str(user_id))
        .single()
        .execute()
    )
    data = _extract_response_data(response, {}) or {}
    if not data:
        raise ValueError("Profile not found.")
    return data


def update_profile(user_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    payload = dict(fields or {})
    if not payload:
        return get_profile(user_id)
    response = (
        supabase_client
        .from_("profiles")
        .update(payload)
        .eq("id", str(user_id))
        .execute()
    )
    updated_rows = _extract_response_data(response, []) or []
    return updated_rows[0] if updated_rows else get_profile(user_id)


def find_user_id_by_subscription_id(subscription_id: str) -> Optional[str]:
    if not subscription_id:
        return None
    response = (
        supabase_client
        .from_("profiles")
        .select("id")
        .eq("razorpay_subscription_id", str(subscription_id))
        .maybe_single()
        .execute()
    )
    data = _extract_response_data(response, {}) or {}
    return data.get("id")


def get_usage_window_descriptor(user_id: str, refresh_window: bool = True) -> dict[str, Any]:
    profile = get_profile(user_id)
    if refresh_window:
        profile = ensure_usage_window(user_id, profile)
    window = _resolve_usage_window_from_profile(profile)
    window.update(
        {
            "user_id": str(user_id),
            "plan_type": str(window.get("plan_type") or "free").lower(),
            "subscription_status": str(profile.get("subscription_status") or "none").lower(),
            "current_period_end": _dt_to_iso(_parse_dt(profile.get("current_period_end"))),
        }
    )
    return window


def _sync_profile_snapshot_to_convex(user_id: str, profile: dict[str, Any]) -> None:
    service = get_convex_usage_service()
    if not service.is_enabled():
        return
    try:
        service.upsert_subscription_snapshot(user_id=str(user_id), profile=profile)
    except Exception as exc:
        logger.warning("[ConvexUsage] Failed to upsert subscription snapshot for user %s: %s", user_id, exc)


def _get_convex_window_usage(user_id: str, window_key: str) -> Optional[dict[str, Any]]:
    service = get_convex_usage_service()
    if not service.is_enabled():
        return None
    try:
        response = service.get_window_usage(user_id=str(user_id), window_key=str(window_key))
        return response if isinstance(response, dict) else None
    except Exception as exc:
        logger.warning("[ConvexUsage] Failed to fetch window usage for user %s key %s: %s", user_id, window_key, exc)
        return None


def _get_convex_lifetime_usage(user_id: str) -> Optional[dict[str, Any]]:
    service = get_convex_usage_service()
    if not service.is_enabled():
        return None
    try:
        response = service.get_lifetime_usage(user_id=str(user_id))
        return response if isinstance(response, dict) else None
    except Exception as exc:
        logger.warning("[ConvexUsage] Failed to fetch lifetime usage for user %s: %s", user_id, exc)
        return None


def get_daily_usage_for_user(user_id: str, day_key: Optional[str] = None, limit: int = 30) -> list[dict[str, Any]]:
    service = get_convex_usage_service()
    if not service.is_enabled():
        return []
    try:
        rows = service.get_daily_usage_for_user(user_id=str(user_id), day_key=day_key, limit=limit)
        return rows if isinstance(rows, list) else []
    except Exception as exc:
        logger.warning("[ConvexUsage] Failed to fetch daily usage for user %s: %s", user_id, exc)
        return []


def get_daily_usage_by_date(day_key: str, limit: int = 500) -> list[dict[str, Any]]:
    service = get_convex_usage_service()
    if not service.is_enabled():
        return []
    try:
        rows = service.get_daily_usage_by_date(day_key=day_key, limit=limit)
        return rows if isinstance(rows, list) else []
    except Exception as exc:
        logger.warning("[ConvexUsage] Failed to fetch daily usage for date %s: %s", day_key, exc)
        return []


def reset_usage_for_new_period(user_id: str) -> None:
    logger.info(
        "[Subscription] Legacy reset_usage_for_new_period called for user %s. No action taken (totals are immutable).",
        user_id,
    )


def _status_grants_paid_access(status: str, current_period_end: Optional[datetime]) -> bool:
    normalized = str(status or "none").strip().lower()
    if normalized in ACCESS_ACTIVE_STATUSES:
        return current_period_end is None or current_period_end > _utc_now()
    if normalized in ACCESS_WINDOW_STATUSES:
        return bool(current_period_end and current_period_end > _utc_now())
    return False


def fetch_razorpay_subscription(subscription_id: str) -> dict[str, Any]:
    if not _razorpay_auth_available():
        raise RuntimeError("Razorpay credentials are not configured.")
    response = requests.get(
        f"{RAZORPAY_API_BASE}/subscriptions/{subscription_id}",
        auth=(config.RAZORPAY_KEY_ID, config.RAZORPAY_KEY_SECRET),
        timeout=30,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(_extract_error_message(response))
    return response.json() or {}


def create_razorpay_subscription(user_id: str, email: str, plan_type: str) -> dict[str, Any]:
    normalized_plan = str(plan_type or "").strip().lower()
    if normalized_plan not in PAID_PLAN_TYPES:
        raise ValueError("Only paid plans can create a Razorpay subscription.")
    if not _razorpay_auth_available():
        raise RuntimeError("Razorpay credentials are not configured.")

    plan_id = get_plan_id_for_type(normalized_plan)
    if not plan_id:
        raise RuntimeError(f"Missing Razorpay plan id for '{normalized_plan}'.")

    summary = calculate_usage_summary(user_id, refresh_window=True)
    current_status = str(summary.get("subscription_status") or "none").lower()
    current_subscription_id = summary.get("razorpay_subscription_id")
    if current_subscription_id and current_status in {
        "created",
        "authenticated",
        "active",
        "pending",
        "paused",
        "resumed",
    }:
        raise RuntimeError("An active or pending Razorpay subscription already exists for this account.")

    payload = {
        "plan_id": plan_id,
        "total_count": config.RAZORPAY_SUBSCRIPTION_TOTAL_COUNT,
        "quantity": 1,
        "customer_notify": 1,
        "notes": {
            "user_id": str(user_id),
            "email": str(email or ""),
            "plan_type": normalized_plan,
        },
    }

    response = requests.post(
        f"{RAZORPAY_API_BASE}/subscriptions",
        auth=(config.RAZORPAY_KEY_ID, config.RAZORPAY_KEY_SECRET),
        json=payload,
        timeout=30,
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(_extract_error_message(response))

    data = response.json() or {}
    update_profile(
        user_id,
        {
            "subscription_status": str(data.get("status") or "created"),
            "razorpay_customer_id": data.get("customer_id"),
            "razorpay_subscription_id": data.get("id"),
        },
    )
    return data


def verify_subscription_checkout_signature(
    payment_id: str,
    subscription_id: str,
    signature: str,
) -> None:
    if not config.RAZORPAY_KEY_SECRET:
        raise RuntimeError("Razorpay key secret is not configured.")

    message = f"{payment_id}|{subscription_id}".encode("utf-8")
    expected_signature = hmac.new(
        config.RAZORPAY_KEY_SECRET.encode("utf-8"),
        message,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_signature, str(signature or "")):
        raise ValueError("Invalid Razorpay checkout signature.")


def verify_webhook_signature(raw_body: bytes, signature: str) -> None:
    if not config.RAZORPAY_WEBHOOK_SECRET:
        raise RuntimeError("RAZORPAY_WEBHOOK_SECRET is not configured.")
    expected_signature = hmac.new(
        config.RAZORPAY_WEBHOOK_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    if not hmac.compare_digest(expected_signature, str(signature or "")):
        raise ValueError("Invalid Razorpay webhook signature.")


def sync_subscription_state(
    user_id: str,
    profile: dict[str, Any],
    subscription_entity: dict[str, Any],
    source: str,
) -> dict[str, Any]:
    now = _utc_now()
    status = str(subscription_entity.get("status") or "none").strip().lower()
    plan_type = resolve_plan_type_from_plan_id(subscription_entity.get("plan_id"))
    current_period_end = _unix_to_dt(subscription_entity.get("current_end"))
    effective_plan = str(profile.get("plan_type") or "free").strip().lower()

    if plan_type and _status_grants_paid_access(status, current_period_end):
        effective_plan = plan_type
    elif plan_type and status in ACCESS_WINDOW_STATUSES and current_period_end and current_period_end > now:
        effective_plan = plan_type
    elif status in TERMINAL_STATUSES or (current_period_end and current_period_end <= now):
        effective_plan = "free"

    update_fields = {
        "plan_type": effective_plan,
        "subscription_status": status,
        "razorpay_customer_id": subscription_entity.get("customer_id"),
        "razorpay_subscription_id": subscription_entity.get("id"),
        "current_period_end": _dt_to_iso(current_period_end) if current_period_end else None,
    }
    updated_profile = update_profile(user_id, update_fields)
    _sync_profile_snapshot_to_convex(user_id, updated_profile)
    return updated_profile


def _refresh_profile_from_razorpay_if_needed(profile: dict[str, Any]) -> dict[str, Any]:
    subscription_id = profile.get("razorpay_subscription_id")
    if not subscription_id or not _razorpay_auth_available():
        return profile

    try:
        entity = fetch_razorpay_subscription(str(subscription_id))
        return sync_subscription_state(
            user_id=str(profile["id"]),
            profile=profile,
            subscription_entity=entity,
            source="razorpay_sync",
        )
    except Exception as exc:
        logger.warning("[Subscription] Failed Razorpay refresh for %s: %s", subscription_id, exc)
        return profile


def ensure_usage_window(user_id: str, profile: dict[str, Any]) -> dict[str, Any]:
    now = _utc_now()
    current_period_end = _parse_dt(profile.get("current_period_end"))
    plan_type = str(profile.get("plan_type") or "free").strip().lower()
    status = str(profile.get("subscription_status") or "none").strip().lower()

    if plan_type in PAID_PLAN_TYPES and current_period_end and current_period_end <= now:
        refreshed = _refresh_profile_from_razorpay_if_needed(profile)
        profile = refreshed or profile
        current_period_end = _parse_dt(profile.get("current_period_end"))
        plan_type = str(profile.get("plan_type") or "free").strip().lower()
        status = str(profile.get("subscription_status") or "none").strip().lower()

    if plan_type == "free":
        if not current_period_end or current_period_end <= now:
            profile = update_profile(
                user_id,
                {
                    "plan_type": "free",
                    "current_period_end": _dt_to_iso(_next_utc_day_boundary(now)),
                },
            )
        _sync_profile_snapshot_to_convex(user_id, profile)
        return profile

    if plan_type in PAID_PLAN_TYPES and not _status_grants_paid_access(status, current_period_end):
        profile = update_profile(
            user_id,
            {
                "plan_type": "free",
                "current_period_end": _dt_to_iso(_next_utc_day_boundary(now)),
            },
        )
        _sync_profile_snapshot_to_convex(user_id, profile)
        return profile

    if plan_type in PAID_PLAN_TYPES and current_period_end and current_period_end <= now:
        profile = update_profile(
            user_id,
            {
                "plan_type": "free",
                "current_period_end": _dt_to_iso(_next_utc_day_boundary(now)),
            },
        )
        _sync_profile_snapshot_to_convex(user_id, profile)
        return profile

    _sync_profile_snapshot_to_convex(user_id, profile)
    return profile


def _build_status_label(plan_type: str, status: str) -> str:
    normalized_status = str(status or "none").strip().lower()
    if plan_type == "free" and normalized_status in {"none", ""}:
        return "Free"
    return normalized_status.replace("_", " ").title()


def calculate_usage_summary(user_id: str, refresh_window: bool = True) -> dict[str, Any]:
    profile = get_profile(user_id)
    if refresh_window:
        profile = ensure_usage_window(user_id, profile)

    usage_window = _resolve_usage_window_from_profile(profile)
    convex_window_usage = _get_convex_window_usage(user_id, str(usage_window.get("window_key")))
    convex_lifetime_usage = _get_convex_lifetime_usage(user_id)

    usage_source = "convex_window" if isinstance(convex_window_usage, dict) else "convex_window_unavailable"
    input_tokens = (
        _to_int(convex_window_usage.get("input_tokens"))
        if isinstance(convex_window_usage, dict)
        else 0
    )
    output_tokens = (
        _to_int(convex_window_usage.get("output_tokens"))
        if isinstance(convex_window_usage, dict)
        else 0
    )
    total_tokens = (
        _to_int(convex_window_usage.get("total_tokens"))
        if isinstance(convex_window_usage, dict)
        else 0
    )
    if total_tokens <= 0:
        total_tokens = input_tokens + output_tokens

    lifetime_input_tokens = (
        _to_int(convex_lifetime_usage.get("input_tokens"))
        if isinstance(convex_lifetime_usage, dict)
        else input_tokens
    )
    lifetime_output_tokens = (
        _to_int(convex_lifetime_usage.get("output_tokens"))
        if isinstance(convex_lifetime_usage, dict)
        else output_tokens
    )
    lifetime_total_tokens = (
        _to_int(convex_lifetime_usage.get("total_tokens"))
        if isinstance(convex_lifetime_usage, dict)
        else total_tokens
    )
    lifetime_created_at = (
        convex_lifetime_usage.get("updated_at_ms")
        if isinstance(convex_lifetime_usage, dict)
        else None
    )

    plan_type = str(profile.get("plan_type") or "free").strip().lower()
    plan = get_plan_config(plan_type)
    limit_tokens = _to_int(plan["limit_tokens"])
    remaining_tokens = max(limit_tokens - total_tokens, 0)
    usage_percent = int(min((total_tokens / limit_tokens) * 100, 100)) if limit_tokens > 0 else 0
    period_end = _parse_dt(usage_window.get("window_end")) or _parse_dt(profile.get("current_period_end"))
    subscription_status = str(profile.get("subscription_status") or "none").strip().lower()
    is_enforceable = usage_source == "convex_window"
    access_locked = bool(is_enforceable and total_tokens >= (5_000_000_000 if plan_type == "free" else limit_tokens))
    _sync_profile_snapshot_to_convex(user_id, profile)

    summary = {
        "plan_type": plan_type,
        "plan_name": plan["name"],
        "price_inr": plan["price_inr"],
        "subscription_status": subscription_status,
        "status_label": _build_status_label(plan_type, subscription_status),
        "current_period_end": _dt_to_iso(period_end),
        "period_label": "Current day" if plan_type == "free" else "Current billing cycle",
        "limit_interval": plan["interval_label"],
        "limit_tokens": limit_tokens,
        "limit_label": format_token_limit(limit_tokens, plan["interval_label"]),
        "remaining_tokens": remaining_tokens,
        "usage_percent": usage_percent,
        "is_limit_reached": access_locked,
        "is_enforceable": is_enforceable,
        "usage_source": usage_source,
        "usage_window": {
            "day_key": usage_window.get("day_key"),
            "window_key": usage_window.get("window_key"),
            "window_start": _dt_to_iso(_parse_dt(usage_window.get("window_start"))),
            "window_end": _dt_to_iso(_parse_dt(usage_window.get("window_end"))),
        },
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "created_at": lifetime_created_at,
        },
        "lifetime_usage": {
            "input_tokens": lifetime_input_tokens,
            "output_tokens": lifetime_output_tokens,
            "total_tokens": lifetime_total_tokens,
            "created_at": lifetime_created_at,
        },
        "plans": get_plan_catalog(),
        "profile": {
            "email": profile.get("email"),
            "name": profile.get("name"),
        },
        "razorpay_customer_id": profile.get("razorpay_customer_id"),
        "razorpay_subscription_id": profile.get("razorpay_subscription_id"),
        "can_create_subscription": not (
            profile.get("razorpay_subscription_id")
            and subscription_status in {"created", "authenticated", "active", "pending", "paused", "resumed"}
        ),
    }
    summary["message"] = format_limit_message(summary) if access_locked else None
    return summary


def format_limit_message(summary: dict[str, Any]) -> str:
    plan_name = summary.get("plan_name") or "Current"
    limit_label = summary.get("limit_label") or "the allowed usage limit"
    period_end = _parse_dt(summary.get("current_period_end"))
    if period_end:
        reset_text = period_end.astimezone(timezone.utc).strftime("%d %b %Y, %H:%M UTC")
        return f"{plan_name} usage limit reached. Your allowance resets at {reset_text}."
    return f"{plan_name} usage limit reached for {limit_label}."


def enforce_usage_limit(user_id: str) -> dict[str, Any]:
    summary = calculate_usage_summary(user_id, refresh_window=True)
    if summary.get("is_limit_reached"):
        raise UsageLimitExceeded(summary)
    return summary


def verify_checkout_and_activate(
    user_id: str,
    payment_id: str,
    subscription_id: str,
    signature: str,
) -> dict[str, Any]:
    verify_subscription_checkout_signature(payment_id, subscription_id, signature)
    entity = fetch_razorpay_subscription(subscription_id)

    entity_notes = entity.get("notes") or {}
    entity_user_id = str(entity_notes.get("user_id") or "").strip()
    profile = get_profile(user_id)
    linked_subscription_id = str(profile.get("razorpay_subscription_id") or "").strip()
    if entity_user_id and entity_user_id != str(user_id):
        raise ValueError("The Razorpay subscription does not belong to this user.")
    if linked_subscription_id and linked_subscription_id != str(subscription_id):
        raise ValueError("This Razorpay subscription is not linked to the active profile.")

    updated_profile = sync_subscription_state(
        user_id=user_id,
        profile=profile,
        subscription_entity=entity,
        source="checkout_verify",
    )
    summary = calculate_usage_summary(user_id, refresh_window=False)
    return {
        "profile": updated_profile,
        "subscription": entity,
        "summary": summary,
    }


def handle_webhook_event(payload: dict[str, Any]) -> dict[str, Any]:
    event_name = str(payload.get("event") or "").strip()
    subscription_entity = (
        (payload.get("payload") or {})
        .get("subscription", {})
        .get("entity", {})
    ) or {}
    if not subscription_entity:
        raise ValueError("Webhook payload does not contain a subscription entity.")

    subscription_id = str(subscription_entity.get("id") or "").strip()
    notes = subscription_entity.get("notes") or {}
    user_id = str(notes.get("user_id") or "").strip() or find_user_id_by_subscription_id(subscription_id)
    if not user_id:
        raise ValueError("Unable to resolve user for webhook event.")

    profile = get_profile(user_id)
    updated_profile = sync_subscription_state(
        user_id=user_id,
        profile=profile,
        subscription_entity=subscription_entity,
        source=f"webhook:{event_name}",
    )
    return {
        "event": event_name,
        "user_id": user_id,
        "subscription_id": subscription_id,
        "status": updated_profile.get("subscription_status"),
    }


def parse_webhook_body(raw_body: bytes) -> dict[str, Any]:
    try:
        return json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid webhook body.") from exc
