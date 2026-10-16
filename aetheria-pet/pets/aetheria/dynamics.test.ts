import assert from "node:assert/strict";
import test from "node:test";
import { getPetScrollPath, stepPetSpring } from "./dynamics";
import { boopReaction, scrollEmotion } from "./emotions";

test("travel settles consistently on 30, 60, and 120 Hz hosts", () => {
  for (const fps of [30, 60, 120]) {
    let state = { position: 100, velocity: 0 };
    let highest = state.position;
    for (let frame = 0; frame < fps * 3; frame++) {
      state = stepPetSpring(state, 600, 1 / fps);
      highest = Math.max(highest, state.position);
    }
    assert.ok(Math.abs(state.position - 600) < .1, `position at ${fps} Hz`);
    assert.ok(Math.abs(state.velocity) < .1, `velocity at ${fps} Hz`);
    assert.ok(highest < 650, `bounded overshoot at ${fps} Hz`);
  }
});

test("a background stall cannot explode the spring", () => {
  const state = stepPetSpring({ position: 100, velocity: 400 }, 600, 30);
  assert.ok(Number.isFinite(state.position) && Number.isFinite(state.velocity));
  assert.ok(state.position > 100 && state.position < 600);
});

test("invalid host input leaves the current spring intact", () => {
  const state = { position: 100, velocity: 0 };
  assert.equal(stepPetSpring(state, NaN, .016), state);
  assert.equal(stepPetSpring(state, 600, Infinity), state);
  assert.deepEqual(stepPetSpring(state, 600, -1), state);
});

test("reverse scrolling retains the same excitement level", () => {
  for (const speed of [.05, .5, 3]) assert.equal(scrollEmotion(speed), scrollEmotion(-speed));
  assert.equal(scrollEmotion(0), "curious");
});

test("tap reactions escalate, then a new streak returns to a single bonk", () => {
  assert.equal(boopReaction(1).emotion, "bonked");
  assert.equal(boopReaction(3).emotion, "dizzy");
  assert.equal(boopReaction(10).emotion, "dizzy");
  assert.equal(boopReaction(1).emotion, "bonked");
  assert.ok(boopReaction(3).durationMs > boopReaction(1).durationMs);
});

test("scroll travel makes four broad left and right turns and returns to its dock", () => {
  const width = 400;
  const height = 300;
  assert.deepEqual(getPetScrollPath(0, width, height), { x: 0, y: 0 });
  for (let turn = 0; turn < 4; turn++) {
    assert.ok(getPetScrollPath(turn / 4 + .125, width, height).x < -width * .99);
    assert.ok(Math.abs(getPetScrollPath((turn + 1) / 4, width, height).x) < .01);
  }
  const end = getPetScrollPath(1, width, height);
  assert.ok(Math.abs(end.x) < .01 && Math.abs(end.y - height) < .01);
});

test("the entire snake route stays within the supplied travel area", () => {
  for (const [width, height] of [[150, 120], [435, 334], [100, 0]]) {
    for (let sample = 0; sample <= 200; sample++) {
      const point = getPetScrollPath(sample / 200, width, height);
      assert.ok(point.x >= -width && point.x <= 0);
      assert.ok(point.y >= 0 && point.y <= height);
    }
  }
  assert.deepEqual(getPetScrollPath(NaN, Infinity, -1), { x: 0, y: 0 });
});
