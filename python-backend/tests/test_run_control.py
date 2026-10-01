import sys
from pathlib import Path

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from run_control import (  # noqa: E402
    RunControl,
    RunControlGate,
    clear_control,
    read_control,
    request_control,
)


class FakeRedis:
    def __init__(self):
        self.store = {}

    def get(self, name):
        value = self.store.get(name)
        return value.encode() if isinstance(value, str) else value

    def set(self, name, value, ex=None):
        self.store[name] = value

    def delete(self, *names):
        for name in names:
            self.store.pop(name, None)


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


def test_pause_resume_and_stop_are_recorded():
    redis = FakeRedis()
    assert request_control(redis, "c1", "pause_run") == "pause"
    assert read_control(redis, "c1") is RunControl.PAUSE
    assert request_control(redis, "c1", "resume_run") is None
    assert read_control(redis, "c1") is None
    assert request_control(redis, "c1", "stop_run") == "stop"
    # A later pause or resume does not undo a stop.
    assert request_control(redis, "c1", "resume_run") == "stop"
    assert read_control(redis, "c1") is RunControl.STOP
    clear_control(redis, "c1")
    assert read_control(redis, "c1") is None


def test_unknown_message_type_is_rejected():
    with pytest.raises(ValueError):
        request_control(FakeRedis(), "c1", "explode_run")


def test_gate_stops_when_stop_requested():
    redis = FakeRedis()
    clock = FakeClock()
    gate = RunControlGate(redis, "c1", sleep=clock.sleep, clock=clock, check_interval=0)
    assert gate.checkpoint() is False
    request_control(redis, "c1", "stop_run")
    assert gate.checkpoint() is True
    assert gate.stopped is True


def test_gate_blocks_while_paused_then_resumes():
    redis = FakeRedis()
    clock = FakeClock()
    events = []

    def sleep(seconds):
        clock.sleep(seconds)
        if clock.now >= 2:
            request_control(redis, "c1", "resume_run")

    gate = RunControlGate(
        redis, "c1",
        on_paused=lambda: events.append("paused"),
        on_resumed=lambda: events.append("resumed"),
        sleep=sleep, clock=clock, check_interval=0,
    )
    request_control(redis, "c1", "pause_run")
    assert gate.checkpoint() is False
    assert events == ["paused", "resumed"]
    assert clock.now >= 2


def test_stop_during_pause_ends_the_run():
    redis = FakeRedis()
    clock = FakeClock()

    def sleep(seconds):
        clock.sleep(seconds)
        request_control(redis, "c1", "stop_run")

    gate = RunControlGate(redis, "c1", sleep=sleep, clock=clock, check_interval=0)
    request_control(redis, "c1", "pause_run")
    assert gate.checkpoint() is True


def test_pause_is_capped():
    redis = FakeRedis()
    clock = FakeClock()
    gate = RunControlGate(redis, "c1", sleep=clock.sleep, clock=clock, check_interval=0, max_pause_seconds=5)
    request_control(redis, "c1", "pause_run")
    assert gate.checkpoint() is False
    assert clock.now >= 5
    assert read_control(redis, "c1") is None


def test_checks_are_throttled():
    calls = []

    class CountingRedis(FakeRedis):
        def get(self, name):
            calls.append(name)
            return super().get(name)

    clock = FakeClock()
    gate = RunControlGate(CountingRedis(), "c1", clock=clock, check_interval=1)
    for _ in range(10):
        gate.checkpoint()
    assert len(calls) == 1
    clock.now = 1.5
    gate.checkpoint()
    assert len(calls) == 2


def test_redis_outage_does_not_stop_the_run():
    class BrokenRedis(FakeRedis):
        def get(self, name):
            raise ConnectionError("redis down")

    gate = RunControlGate(BrokenRedis(), "c1", check_interval=0)
    assert gate.checkpoint() is False
