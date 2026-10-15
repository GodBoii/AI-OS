import json
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlsplit, urlunsplit


SEARCH_TOOL_NAMES = frozenset({"web_search", "search_news", "duckduckgo_search", "duckduckgo_news"})


def _search_preview_output(tool_name: str, output: Any, failed: bool) -> Optional[Dict[str, Any]]:
    """Project search results for the UI without changing the model's native result.

    Mobile also has a web_search tool, but returns a command-result object.
    Leave objects and other tools on their existing serialization path.
    """
    if tool_name not in SEARCH_TOOL_NAMES or not isinstance(output, (list, str)):
        return None

    links: list[dict[str, str]] = []
    seen: set[str] = set()
    if isinstance(output, list) and not failed:
        for item in output:
            if not isinstance(item, dict):
                continue
            raw = item.get("href") or item.get("url")
            if not isinstance(raw, str):
                continue
            raw = raw.strip()
            if not raw or len(raw) > 8192 or any(
                ord(char) <= 32 or ord(char) == 127 or char == "\\" for char in raw
            ):
                continue
            try:
                parsed = urlsplit(raw)
                if (
                    parsed.scheme not in {"http", "https"}
                    or not parsed.hostname
                    or parsed.username is not None
                    or parsed.password is not None
                ):
                    continue
                host = parsed.hostname.encode("idna").decode("ascii").lower()
                host = f"[{host}]" if ":" in host else host
                port = parsed.port
                if port is not None and (parsed.scheme, port) not in {("http", 80), ("https", 443)}:
                    host = f"{host}:{port}"
                url = urlunsplit((parsed.scheme, host, parsed.path or "/", parsed.query, parsed.fragment))
            except (ValueError, UnicodeError):
                continue
            if url not in seen:
                seen.add(url)
                links.append({"url": url})

    if failed:
        state = "failed"
    elif links:
        state = "ready"
    elif output == []:
        state = "empty"
    else:
        state = "unavailable"
    preview = {"ok": not failed, "metadata": {
        "kind": "web_search_tool_output", "preview_type": "link_list", "state": state,
        "inline": {"links": links},
    }}
    if failed:
        preview["error"] = "Search failed."
    return preview


def _safe_json_like(value: Any) -> Any:
    """Best-effort conversion for values that may be serialized JSON strings."""
    if value is None:
        return None
    if isinstance(value, (dict, list, int, float, bool)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return text
        if text.startswith("{") or text.startswith("["):
            try:
                return json.loads(text)
            except Exception:
                return value
        return value
    return value


def _read_field(source: Any, field: str) -> Any:
    if source is None:
        return None
    if isinstance(source, dict):
        return source.get(field)
    return getattr(source, field, None)


def _looks_like_tool_payload(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    if isinstance(value.get("metadata"), dict):
        return True
    known_keys = {"ok", "message", "data", "status", "error", "result", "output"}
    return bool(known_keys.intersection(value.keys()))


def _normalize_output_candidate(value: Any, field_name: str) -> Any:
    parsed = _safe_json_like(value)

    # `content` often carries plain text on chunks; only accept if structured.
    if field_name == "content" and not isinstance(parsed, (dict, list)):
        return None

    if isinstance(parsed, dict):
        if _looks_like_tool_payload(parsed):
            return parsed

        # Common wrapper shape: {"content": "{\"ok\":...}"}
        wrapped_content = parsed.get("content")
        wrapped_parsed = _safe_json_like(wrapped_content)
        if _looks_like_tool_payload(wrapped_parsed):
            return wrapped_parsed

        # Metadata-only maps are still useful for frontend rendering.
        if isinstance(parsed.get("kind"), str):
            return {"metadata": parsed}

    return parsed


def _extract_tool_output(tool_obj: Any, chunk_obj: Any = None) -> Tuple[Any, Optional[str]]:
    """
    Extract tool output across varying event shapes.
    Returns (output, source_field_name).
    """
    candidates = (
        "tool_output",
        "output",
        "result",
        "response",
        "content",
    )

    for source in (tool_obj, chunk_obj):
        for field_name in candidates:
            raw = _read_field(source, field_name)
            if raw is None:
                continue
            normalized = _normalize_output_candidate(raw, field_name)
            if normalized is not None:
                return normalized, field_name

    # Last-resort: if a wrapper object has `.content` with structured payload.
    for source in (tool_obj, chunk_obj):
        if source is None or isinstance(source, (dict, str, int, float, bool, list)):
            continue
        content = getattr(source, "content", None)
        normalized = _normalize_output_candidate(content, "content")
        if normalized is not None:
            return normalized, "content"

    return None, None


def serialize_tool_event(tool_obj: Any, chunk_obj: Any = None) -> Dict[str, Any] | None:
    """Extract frontend-safe parts of a tool event with resilient output parsing."""
    if not tool_obj and not chunk_obj:
        return None

    tool_name = _read_field(tool_obj, "tool_name") or _read_field(chunk_obj, "tool_name")
    tool_args = _safe_json_like(_read_field(tool_obj, "tool_args"))
    tool_output, _source_field = _extract_tool_output(tool_obj, chunk_obj)
    if tool_output is not None:
        preview = _search_preview_output(tool_name, tool_output, bool(_read_field(tool_obj, "tool_call_error")))
        if preview is not None:
            tool_output = preview

    payload: Dict[str, Any] = {}
    call_id = _read_field(tool_obj, "tool_call_id") or _read_field(chunk_obj, "tool_call_id")
    if call_id:
        payload["tool_call_id"] = str(call_id)
    if _read_field(tool_obj, "tool_call_error"):
        payload["tool_call_error"] = True
    if tool_name:
        payload["tool_name"] = tool_name
    if tool_args is not None:
        payload["tool_args"] = tool_args
    if tool_output is not None:
        payload["tool_output"] = tool_output

        # Non-breaking mirror for future frontend fallback resilience.
        if isinstance(tool_output, dict):
            metadata = tool_output.get("metadata")
            if isinstance(metadata, dict):
                payload["metadata"] = metadata

    return payload or None

