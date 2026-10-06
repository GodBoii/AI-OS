"""Check the shared backend's Android tool registration and socket contract."""

import importlib.util
import json
import sys
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock

import pytest

from assistant_stream_utils import build_system_assistant_terminal_message
from mobile_action_contract import COMMAND_TTL_SECONDS, CONTRACT_VERSION, EXPOSED_ACTIONS


@pytest.fixture
def toolkit(monkeypatch):
    # Redis is an external transport. Loading its annotation must not require a
    # local Redis installation for these socket/response boundary tests.
    if importlib.util.find_spec("redis") is None:
        redis_module = ModuleType("redis")
        redis_module.Redis = object
        monkeypatch.setitem(sys.modules, "redis", redis_module)

    path = Path(__file__).resolve().parents[1] / "mobile_tools.py"
    spec = importlib.util.spec_from_file_location("mobile_tools_sync_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module.time, "time", lambda: 1_800_000_000.0)

    redis_client = Mock()
    redis_client.pubsub.return_value.get_message.return_value = {
        "data": json.dumps({"status": "success"}).encode(),
    }
    return module.MobileTools(
        sid="android-client", socketio=Mock(), redis_client=redis_client,
        conversation_id="conversation-123", message_id="message-123",
    )


def test_every_contract_action_is_registered_with_agno(toolkit):
    assert set(toolkit.functions) == set(EXPOSED_ACTIONS)


@pytest.mark.parametrize("method,args,expected", [
    ("get_visible_ui_text", {"limit": 100}, {"limit": 40}),
    ("get_travel_estimate", {"destination": "Station"}, {"destination": "Station", "mode": "driving"}),
    ("prepare_navigation", {"destination": "Station", "mode": "walking"}, {"destination": "Station", "mode": "walking"}),
    ("open_navigation", {"destination": "Station"}, {"destination": "Station", "mode": "driving"}),
    ("set_flashlight", {"enabled": False}, {"enabled": False}),
    ("media_control", {"command": " PAUSE "}, {"command": "pause"}),
    ("create_calendar_event", {"title": "Meeting", "start_time_ms": 123000},
     {"title": "Meeting", "start_time_ms": 123000, "end_time_ms": 0, "all_day": False, "location": "", "description": ""}),
    ("dial_number", {"number": "+123456789"}, {"number": "+123456789"}),
    ("web_search", {"query": "train timetable"}, {"query": "train timetable"}),
    ("pick_contact", {}, {}),
])
def test_android_tools_emit_fresh_commands_and_release_response_subscription(toolkit, method, args, expected):
    result = getattr(toolkit, method)(**args)
    assert json.loads(result.content) == {"status": "success"}

    call = toolkit.socketio.emit.call_args
    event, payload = call.args
    assert event == "mobile-command"
    assert call.kwargs == {"room": "android-client"}
    assert payload["action"] == method
    assert payload["contract_version"] == CONTRACT_VERSION
    assert payload["issued_at_ms"] == 1_800_000_000_000
    assert payload["expires_at_ms"] - payload["issued_at_ms"] == COMMAND_TTL_SECONDS * 1000
    assert payload["conversation_id"] == "conversation-123"
    assert payload["message_id"] == "message-123"
    assert payload["request_id"]
    for key, value in expected.items():
        assert payload[key] == value

    response_channel = f"mobile-response:{payload['request_id']}"
    pubsub = toolkit.redis_client.pubsub.return_value
    pubsub.subscribe.assert_called_once_with(response_channel)
    pubsub.unsubscribe.assert_called_once_with(response_channel)
    pubsub.close.assert_called_once_with()


@pytest.mark.parametrize("name,status,expected", [
    ("create_calendar_event", "success", "I opened the calendar with the event filled in. Save it there to add it."),
    ("dial_number", "success", "I opened the dialer with the number ready. Press call when you're ready."),
    ("pick_contact", "success", "I got the contact you picked."),
    ("pick_contact", "cancelled", "No contact was picked."),
    ("dial_number", "error", "I couldn't complete the last device step. Please review the current screen."),
])
def test_terminal_message_matches_native_result(name, status, expected):
    history = [{"name": name, "payload": {"tool_output": {"status": status}}}]
    assert build_system_assistant_terminal_message(history) == expected
