import io
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from agno.db.base import SessionType
from agno.models.response import ToolExecution
from agno.tools.function import UserFeedbackQuestion, UserFeedbackOption
from agno.run.agent import RunOutput
from agno.run.base import RunStatus
from agno.run.requirement import RunRequirement
from agno.session import AgentSession

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import agno_storage
import local_media
from user_questions import QuestionRepository
from usage_legs import metric_delta, metric_snapshot


@pytest.fixture
def local_store(tmp_path, monkeypatch):
    monkeypatch.setenv('AGENT_STORAGE_ROOT', str(tmp_path))
    monkeypatch.setenv('MEDIA_STORAGE_ROOT', str(tmp_path / 'media'))
    monkeypatch.setenv('MEDIA_SIGNING_KEY', 'test-media-signing-key')
    agno_storage.get_agno_db.cache_clear()
    agno_storage.get_engine.cache_clear()
    local_media.media_storage.cache_clear()
    db = agno_storage.get_agno_db()
    yield db
    agno_storage.get_engine().dispose()
    agno_storage.get_agno_db.cache_clear()
    agno_storage.get_engine.cache_clear()
    local_media.media_storage.cache_clear()


def paused_run():
    requirement = RunRequirement(ToolExecution(tool_call_id='ask', tool_name='ask_user', requires_user_input=True,
        user_feedback_schema=[UserFeedbackQuestion(question='Which platform?', header='Platform',
            options=[UserFeedbackOption(label='Linux'), UserFeedbackOption(label='Windows')])]))
    return RunOutput(run_id=str(uuid.uuid4()), user_id='owner', session_id='chat', status=RunStatus.paused,
        requirements=[requirement])


def test_questions_persist_reject_other_users_and_accept_one_submission(local_store):
    repository = QuestionRepository()
    row = repository.create(run=paused_run(), conversation_id='chat', message_id='message', user_id='owner', context={})
    answers = {row['questions'][0]['id']: {'selected': ['Linux'], 'text': ''}}
    assert QuestionRepository().get(row['request_id'], 'other') is None
    with pytest.raises(LookupError):
        repository.submit(row['request_id'], 'other', str(uuid.uuid4()), answers)
    def submit():
        try:
            return repository.submit(row['request_id'], 'owner', str(uuid.uuid4()), answers)[1]
        except ValueError:
            return False
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: submit(), range(2))) == [False, True]
    stored = repository.get(row['request_id'], 'owner')
    assert stored['answers'] == answers
    assert repository.submit(row['request_id'], 'owner', stored['submission_id'], answers)[1] is False
    repository.finish(row['request_id'], 'answered')
    assert repository.get(row['request_id'], 'owner')['status'] == 'answered'


def test_expiry_and_cancel_persist(local_store):
    from sqlalchemy import update
    repository = QuestionRepository()
    row = repository.create(run=paused_run(), conversation_id='chat', message_id='message', user_id='owner', context={})
    with repository.engine.begin() as connection:
        connection.execute(update(repository.table).where(repository.table.c.request_id == row['request_id']).values(expires_at=0))
    answers = {row['questions'][0]['id']: {'selected': ['Linux'], 'text': ''}}
    with pytest.raises(ValueError, match='expired'):
        repository.submit(row['request_id'], 'owner', str(uuid.uuid4()), answers)
    assert repository.get(row['request_id'], 'owner')['status'] == 'expired'
    row = repository.create(run=paused_run(), conversation_id='chat', message_id='message', user_id='owner', context={})
    repository.cancel('chat', 'owner')
    with pytest.raises(ValueError):
        repository.submit(row['request_id'], 'owner', str(uuid.uuid4()), answers)


def test_history_is_local_user_scoped_and_titles_are_editable(local_store):
    local_store.upsert_session(AgentSession(session_id='chat', user_id='owner', agent_id='coder', runs=[RunOutput(
        run_id='run', user_id='owner', session_id='chat', content='Done', status=RunStatus.completed)]))
    agno_storage.save_title('chat', 'owner', 'Original')
    assert agno_storage.conversation_owner('chat') == 'owner'
    assert agno_storage.session_history('chat', 'other') is None
    assert agno_storage.list_sessions('other') == []
    assert agno_storage.list_sessions('owner')[0]['session_title'] == 'Original'
    agno_storage.save_title('chat', 'other', 'Hijacked')
    assert agno_storage.get_title('chat', 'owner') == 'Original'


def test_media_is_private_on_disk_and_write_tokens_are_single_use(local_store):
    storage = local_media.media_storage()
    path = 'owner/chat/image.png'
    upload = storage.create_signed_upload_url(path)['signed_url']
    token = upload.rsplit('/', 1)[-1]
    assert local_media.verify_transfer(token, 'write') == path
    with pytest.raises(ValueError):
        local_media.verify_transfer(token, 'read')
    storage.upload_stream(path, io.BytesIO(b'png-content'), 'image/png')
    assert storage.download(path) == b'png-content'
    assert storage.metadata(path)['size_bytes'] == 11
    with pytest.raises(FileExistsError):
        storage.upload_stream(path, io.BytesIO(b'replaced'), 'image/png')
    assert storage.download(path) == b'png-content'
    with pytest.raises(ValueError):
        local_media.safe_path('../secret')
    storage.remove([path])
    assert storage.metadata(path) is None


def test_continuations_count_only_new_tokens_and_deduplicate_members():
    from agno.metrics import RunMetrics
    from agno.run.team import TeamRunOutput
    member = RunOutput(run_id='child', metrics=RunMetrics(input_tokens=10, output_tokens=5, total_tokens=15))
    root = TeamRunOutput(run_id='root', metrics=RunMetrics(input_tokens=10, output_tokens=5, total_tokens=15),
        member_responses=[member, member])
    before = metric_snapshot(root)
    assert metric_delta(before)['total_tokens'] == 30
    member.metrics = RunMetrics(input_tokens=20, output_tokens=10, total_tokens=30)
    assert metric_delta(metric_snapshot(root), before)['total_tokens'] == 15
