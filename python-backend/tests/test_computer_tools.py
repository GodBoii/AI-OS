"""Test the public toolkit without a live cloud account or Redis server."""
import base64
import importlib.util
import json
import sys
import types
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
import local_media  # Load the real storage dependency before isolating Agno toolkit objects.


@pytest.fixture
def computer_module(monkeypatch):
    class Toolkit:
        def __init__(self, **kwargs):
            self.tools = kwargs['tools']

    class ToolResult:
        def __init__(self, content, images=None):
            self.content = content
            self.images = images or []

    class Image:
        def __init__(self, content):
            self.content = content

    for name, attrs in {
        'redis': {'Redis': object},
        'agno': {}, 'agno.media': {'Image': Image},
        'agno.tools': {'Toolkit': Toolkit}, 'agno.tools.function': {'ToolResult': ToolResult},
        'supabase_client': {'supabase_client': None},
    }.items():
        module = types.ModuleType(name)
        module.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, module)
    spec = importlib.util.spec_from_file_location('computer_tools_under_test', Path(__file__).resolve().parents[1] / 'computer_tools.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PubSub:
    def __init__(self, messages=(), unsubscribe_error=False):
        self.messages = iter(messages)
        self.closed = False
        self.unsubscribe_error = unsubscribe_error
        self.polls = []
        self.acknowledged = False

    def subscribe(self, channel):
        self.channel = channel

    def get_message(self, timeout):
        self.polls.append(timeout)
        if not self.acknowledged:
            self.acknowledged = True
            return {'type': 'subscribe', 'channel': self.channel.encode(), 'data': 1}
        return next(self.messages, None)

    def unsubscribe(self, channel):
        if self.unsubscribe_error:
            raise RuntimeError('Redis disconnected')
        self.unsubscribed = channel

    def close(self):
        self.closed = True


def make_tools(module, pubsub):
    events = []
    socket = types.SimpleNamespace(emit=lambda *args, **kwargs: events.append((args, kwargs)))
    redis = types.SimpleNamespace(pubsub=lambda: pubsub)
    return module.ComputerTools('desktop-session', socket, redis), events


def test_registered_public_tools_and_targeted_payloads(computer_module):
    toolkit, _ = make_tools(computer_module, PubSub())
    payloads = []
    toolkit._send_command_and_wait = lambda payload: payloads.append(payload) or payload
    toolkit.click_mouse(x=2, y=3, window_id=10, screenshot_id='s')
    toolkit.type_text('😀 नमस्ते', window_id=10)
    toolkit.scroll('left', window_id=10, x=2, y=3)
    toolkit.get_window_state(10, include_screenshot=False)
    toolkit.perform_element_action('o', '3', 'invoke')
    assert payloads[0]['window_id'] == 10
    assert payloads[0]['screenshot_id'] == 's'
    assert payloads[1]['text'] == '😀 नमस्ते'
    assert payloads[2]['direction'] == 'left'
    assert payloads[3]['include_screenshot'] is False
    assert payloads[4]['observation_id'] == 'o'
    names = {tool.__name__ for tool in toolkit.tools}
    assert {'get_window_state', 'perform_element_action'} <= names
    assert 'window_id' not in toolkit.click_mouse()


def test_long_slow_typing_has_a_deadline_large_enough_for_its_text(computer_module):
    pubsub = PubSub([{'type': 'message', 'data': '{"status":"success"}'}])
    toolkit, events = make_tools(computer_module, pubsub)
    computer_module.time = types.SimpleNamespace(monotonic=lambda: 0, time=lambda: 100)
    toolkit.type_text('a' * 1000)
    payload = events[0][0][1]
    assert payload['expires_at_ms'] == 350000


def test_browser_proxy_allows_long_slow_typing_to_finish(computer_module, monkeypatch):
    spec = importlib.util.spec_from_file_location('browser_tools_under_test', Path(__file__).resolve().parents[1] / 'browser_tools.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    ticks = iter([0, 130])
    module.time = types.SimpleNamespace(monotonic=lambda: next(ticks))
    pubsub = PubSub()
    pubsub.get_message = lambda **kwargs: {'type': 'message', 'data': '{"status":"success"}'}
    socket = types.SimpleNamespace(emit=lambda *args, **kwargs: None)
    toolkit = module.BrowserTools('desktop-session', socket, types.SimpleNamespace(pubsub=lambda: pubsub))
    result = toolkit.type_text(1, 'a' * 1000)
    assert json.loads(result.content)['status'] == 'success'
    assert pubsub.closed


def test_wait_ignores_subscribe_ack_and_parses_response(computer_module):
    pubsub = PubSub([{'type': 'subscribe'}, {'type': 'message', 'data': b'{"status":"success","enabled":true}'}])
    toolkit, events = make_tools(computer_module, pubsub)
    result = toolkit.get_status()
    assert json.loads(result.content)['enabled'] is True
    assert pubsub.closed
    assert pubsub.unsubscribed == pubsub.channel
    assert events[0][0][0] == 'computer-command'
    assert events[0][1]['room'] == 'desktop-session'


def test_timeout_reports_unknown_outcome_and_cleans_up(computer_module):
    ticks = iter(range(100))
    computer_module.time = types.SimpleNamespace(monotonic=lambda: next(ticks), time=lambda: 100)
    computer_module.COMPUTER_COMMAND_TIMEOUT_SECONDS = 3
    pubsub = PubSub()
    toolkit, _ = make_tools(computer_module, pubsub)
    result = toolkit.type_text('test')
    assert result['outcome'] == 'unknown'
    assert 'observe' in result['error']
    assert result['request_id']
    assert pubsub.closed
    assert all(0 <= timeout <= 1 for timeout in pubsub.polls)


def test_subscription_timeout_never_sends_a_command(computer_module):
    ticks = iter(range(100))
    computer_module.time = types.SimpleNamespace(monotonic=lambda: next(ticks), time=lambda: 100)
    computer_module.COMPUTER_COMMAND_TIMEOUT_SECONDS = 3
    pubsub = PubSub()
    pubsub.acknowledged = True
    toolkit, events = make_tools(computer_module, pubsub)
    assert toolkit.get_status()['outcome'] == 'not_executed'
    assert events == []
    assert pubsub.closed


@pytest.mark.parametrize('data', [b'bad json', b'[]', b'null'])
def test_invalid_bridge_results_are_errors_and_close_the_subscription(computer_module, data):
    pubsub = PubSub([{'type': 'message', 'data': data}])
    toolkit, _ = make_tools(computer_module, pubsub)
    assert toolkit.get_status()['status'] == 'error'
    assert pubsub.closed


def test_cleanup_failure_does_not_replace_a_valid_result(computer_module):
    pubsub = PubSub([{'type': 'message', 'data': '{"status":"success"}'}], unsubscribe_error=True)
    toolkit, _ = make_tools(computer_module, pubsub)
    assert json.loads(toolkit.get_status().content)['status'] == 'success'
    assert pubsub.closed


def test_connection_failure_before_subscription_is_reported(computer_module):
    toolkit, _ = make_tools(computer_module, PubSub())
    def fail():
        raise ConnectionError('Redis unavailable')
    toolkit.redis_client.pubsub = fail
    assert toolkit.get_status()['status'] == 'error'
    toolkit.sid = None
    assert 'unavailable' in toolkit.get_status()['error']


def test_inline_screenshot_works_without_cloud_storage_and_preserves_source_result(computer_module):
    toolkit, _ = make_tools(computer_module, PubSub())
    source = {'status': 'success', 'screenshot_path': None,
              'screenshot_base64': base64.b64encode(b'png-test-bytes').decode(), 'screenshot_id': 's'}
    result = toolkit._process_screenshot_result(source)
    assert result.images[0].content == b'png-test-bytes'
    assert json.loads(result.content) == {'status': 'success', 'screenshot_id': 's'}
    assert 'screenshot_base64' in source


def test_invalid_screenshot_cannot_report_success(computer_module):
    toolkit, _ = make_tools(computer_module, PubSub())
    result = toolkit._process_screenshot_result({'status': 'success', 'screenshot_base64': 'bad!base64'})
    assert json.loads(result.content)['status'] == 'error'
    assert result.images == []
