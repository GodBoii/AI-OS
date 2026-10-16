"""Exercise production attachment conversion and both Plan socket paths offline."""
import ast
import json
import logging
import sys
import traceback
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from agno.media import Audio, File, Image, Video
from agno.models.message import Message
from agno.run.agent import RunEvent

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import plan_agent
from model_routing import DEFAULT_MODEL_ID, is_video_attachment, normalize_thinking_mode
from openrouter_reasoning_model import get_openrouter_model


def load_function(file, name, namespace):
    """Load the real boundary without starting Flask, Redis or remote services."""
    tree = ast.parse((ROOT / file).read_text(encoding='utf-8'))
    node = next(item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name == name)
    node.decorator_list = []
    future = ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0)
    module = ast.fix_missing_locations(ast.Module(body=[future, node], type_ignores=[]))
    exec(compile(module, str(ROOT / file), 'exec'), namespace)
    return namespace[name]


@pytest.fixture
def attachments():
    return [
        {'name': 'photo.png', 'type': 'image/png', 'path': 'owner/photo.png'},
        {'name': 'recording.wav', 'type': 'audio/wav', 'path': 'owner/recording.wav'},
        {'name': 'clip.mp4', 'type': 'video/mp4', 'path': 'owner/clip.mp4'},
        {'name': 'notes.txt', 'type': 'text/plain', 'isText': True, 'content': 'Full attachment text'},
    ]


@pytest.fixture
def converter():
    namespace = {'logger': logging.getLogger(__name__), 'Image': Image, 'Audio': Audio, 'Video': Video, 'File': File,
        'is_video_attachment': is_video_attachment,
        'media_storage': lambda: SimpleNamespace(download=lambda path: path.encode())}
    return load_function('agent_runner.py', 'process_files', namespace)


def test_mixed_media_reaches_the_shared_model_request(attachments, converter):
    images, audio, videos, documents = converter(attachments, 'owner')
    assert len(images) == len(audio) == len(videos) == 1
    assert not documents
    assert images[0].content == b'owner/photo.png'
    assert audio[0].content == b'owner/recording.wav'
    assert videos[0].content == b'owner/clip.mp4'
    message = Message(role='user', content='Read the attached media', images=images, audio=audio, videos=videos)
    formatted = get_openrouter_model(DEFAULT_MODEL_ID)._format_message(message)
    assert {'text', 'image_url', 'input_audio', 'video_url'} <= {part['type'] for part in formatted['content']}


def test_media_ownership_check_still_applies(attachments, converter):
    with pytest.raises(PermissionError, match='does not belong'):
        converter(attachments, 'another-user')


@pytest.mark.parametrize('interactive', [False, True])
@pytest.mark.parametrize('thinking_mode', ['standard', 'ultra'])
def test_plan_socket_retains_media_and_thinking_mode(attachments, converter, interactive, thinking_mode):
    spawned = []
    streamed = []
    def legacy_stream(**kwargs):
        streamed.append(kwargs)
        yield {'type': 'done', 'plan': 'Plan from all attachments'}
    namespace = {
        'request': SimpleNamespace(sid='socket'), 'json': json, 'uuid': uuid,
        '_socket_auth_tokens': {}, 'socketio': SimpleNamespace(emit=Mock()),
        'get_user_from_jwt': lambda token: (SimpleNamespace(id='owner'), None),
        '_sanitize_plan_config': lambda config: config, 'conversation_owner': lambda cid: None,
        'run_state_manager_instance': None,
        'QuestionRepository': lambda: SimpleNamespace(list_for_conversation=lambda *args, **kwargs: []),
        'connection_manager_service': SimpleNamespace(get_session=lambda cid: None, create_session=lambda *args, **kwargs: {}),
        'join_room': Mock(), '_register_socket_conversation': Mock(), 'save_title': Mock(),
        'eventlet': SimpleNamespace(spawn=lambda *args: spawned.append(args)),
        'run_agent_and_stream': object(), 'redis_client_instance': None,
        'build_plan_prompt': plan_agent.build_plan_prompt, 'normalize_thinking_mode': normalize_thinking_mode,
        'DEFAULT_MODEL_ID': DEFAULT_MODEL_ID, 'stream_plan': legacy_stream,
        'process_files': converter, 'config': SimpleNamespace(AGNO_DEBUG_MODE=False),
        'logger': logging.getLogger(__name__), 'traceback': traceback,
    }
    namespace['build_inline_text_files_prompt'] = load_function('agent_runner.py', 'build_inline_text_files_prompt', {})
    handler = load_function('sockets.py', 'on_plan_request', namespace)
    handler({'accessToken': 'fixture-token', 'requestId': 'request', 'messageId': 'message',
        'conversationId': 'conversation', 'message': 'Plan from these files', 'files': attachments,
        'supports_user_questions': interactive, 'thinking_mode': thinking_mode})
    if interactive:
        assert len(spawned) == 1
        turn = spawned[0][4]
        assert turn['files'] == attachments
        assert turn['thinking_mode'] == thinking_mode
        assert 'photo.png' in turn['plan_prompt'] and 'clip.mp4' in turn['plan_prompt']
    else:
        assert len(streamed) == 1
        assert streamed[0]['files'] == attachments
        for key in ['images', 'audio', 'videos']:
            assert len(streamed[0]['media'][key]) == 1
        assert 'Full attachment text' in streamed[0]['attachment_text']


def test_legacy_plan_stream_passes_actual_media_and_text_to_agent(monkeypatch, attachments, converter):
    calls = []
    def run(prompt, **kwargs):
        calls.append((prompt, kwargs))
        yield SimpleNamespace(event=RunEvent.run_content.value, agent_name='plan_agent', content='Media-informed plan')
    monkeypatch.setattr(plan_agent, 'create_plan_agent', lambda **kwargs: SimpleNamespace(run=run))
    images, audio, videos, files = converter(attachments, 'owner')
    events = list(plan_agent.stream_plan('Plan this', files=attachments,
        media={'images': images, 'audio': audio, 'videos': videos, 'files': files}, attachment_text='Full attachment text'))
    assert events[-1] == {'type': 'done', 'plan': 'Media-informed plan'}
    assert 'Full attachment text' in calls[0][0]
    assert calls[0][1]['images'] == images
    assert calls[0][1]['audio'] == audio
    assert calls[0][1]['videos'] == videos


def test_interactive_plan_keeps_inline_text_in_final_prompt():
    tree = ast.parse((ROOT / 'agent_runner.py').read_text(encoding='utf-8'))
    block = next(node for node in ast.walk(tree) if isinstance(node, ast.If)
        and ast.unparse(node.test) == "requested_mode == 'plan'"
        and any(isinstance(child, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'final_user_message'
            for target in child.targets) for child in node.body))
    namespace = {'requested_mode': 'plan', 'turn_data': {'plan_prompt': 'Plan instructions'},
        'inline_text_files_prompt': 'Full attachment text'}
    exec(compile(ast.Module(body=[block], type_ignores=[]), 'plan-prompt', 'exec'), namespace)
    assert namespace['final_user_message'] == 'Full attachment text\nPlan instructions'
