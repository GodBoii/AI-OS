"""Pause, resume and stop requests for a running agent turn.

The desktop app's taskbar buttons send `pause_run`, `resume_run` and
`stop_run` messages. `sockets.py` records the request in Redis and the agent
loop in `agent_runner.py` checks it between streamed chunks, so the control
works whichever worker process is running the turn.

Pausing works by not pulling the next chunk from the agent's generator, which
holds tool execution and further model calls. A model response that is
already streaming stays open on the provider side while paused, so pauses are
capped at MAX_PAUSE_SECONDS and then the run resumes on its own.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional, Protocol

logger = logging.getLogger(__name__)

KEY_PREFIX = "run_control:"
# Long enough to outlive any single turn; a stale key is cleared at run start.
KEY_TTL_SECONDS = 2 * 60 * 60
MAX_PAUSE_SECONDS = 10 * 60
CHECK_INTERVAL_SECONDS = 0.3
PAUSE_POLL_SECONDS = 0.5


class RunControl(str, Enum):
    PAUSE = "pause"
    STOP = "stop"


MESSAGE_TYPES = {
    "pause_run": RunControl.PAUSE,
    "resume_run": None,
    "stop_run": RunControl.STOP,
}


class RedisLike(Protocol):
    def get(self, name: str): ...
    def set(self, name: str, value: str, ex: Optional[int] = None): ...
    def delete(self, *names: str): ...


def _key(conversation_id: str) -> str:
    return f"{KEY_PREFIX}{conversation_id}"


def _decode(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    return str(value)


def request_control(redis_client: RedisLike, conversation_id: str, message_type: str) -> Optional[str]:
    """Record a control message. Returns the stored state, or None on resume.

    Stop always wins: a pause or resume after a stop does not undo it.
    """
    if message_type not in MESSAGE_TYPES:
        raise ValueError(f"Unknown run control message: {message_type}")
    key = _key(conversation_id)
    if _decode(redis_client.get(key)) == RunControl.STOP.value:
        return RunControl.STOP.value
    control = MESSAGE_TYPES[message_type]
    if control is None:
        redis_client.delete(key)
        return None
    redis_client.set(key, control.value, ex=KEY_TTL_SECONDS)
    return control.value


def read_control(redis_client: RedisLike, conversation_id: str) -> Optional[RunControl]:
    value = _decode(redis_client.get(_key(conversation_id)))
    try:
        return RunControl(value) if value else None
    except ValueError:
        logger.warning("Ignoring unknown run control value %r for %s", value, conversation_id)
        return None


def clear_control(redis_client: RedisLike, conversation_id: str) -> None:
    redis_client.delete(_key(conversation_id))


@dataclass
class RunControlGate:
    """Checks for control requests from inside the streaming loop.

    `checkpoint()` returns True when the run should stop. While a pause is
    requested it blocks (via `sleep`) until resume, stop or the pause limit.
    """

    redis_client: RedisLike
    conversation_id: str
    on_paused: Callable[[], None] = lambda: None
    on_resumed: Callable[[], None] = lambda: None
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    check_interval: float = CHECK_INTERVAL_SECONDS
    max_pause_seconds: float = MAX_PAUSE_SECONDS
    stopped: bool = False
    _last_check: float = field(default=float("-inf"), init=False)

    def checkpoint(self) -> bool:
        if self.stopped:
            return True
        now = self.clock()
        if now - self._last_check < self.check_interval:
            return False
        self._last_check = now

        control = self._read()
        if control is RunControl.STOP:
            self.stopped = True
            return True
        if control is RunControl.PAUSE:
            return self._wait_while_paused()
        return False

    def _read(self) -> Optional[RunControl]:
        try:
            return read_control(self.redis_client, self.conversation_id)
        except Exception as exc:  # Redis outage must not kill the run.
            logger.warning("Run control check failed for %s: %s", self.conversation_id, exc)
            return None

    def _wait_while_paused(self) -> bool:
        self.on_paused()
        started = self.clock()
        while True:
            if self.clock() - started >= self.max_pause_seconds:
                logger.info("Pause limit reached for %s; resuming", self.conversation_id)
                try:
                    clear_control(self.redis_client, self.conversation_id)
                except Exception as exc:
                    logger.warning("Could not clear expired pause for %s: %s", self.conversation_id, exc)
                break
            self.sleep(PAUSE_POLL_SECONDS)
            control = self._read()
            if control is RunControl.STOP:
                self.stopped = True
                return True
            if control is not RunControl.PAUSE:
                break
        self.on_resumed()
        return False
