import { motion } from "./emotions";

export type SpringState = { position: number; velocity: number };

/** Four continuous S turns. Both ends meet the right edge, so reverse scroll retraces the route. */
export function getPetScrollPath(progress: number, horizontalRange: number, verticalRange: number) {
  const amount = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  const width = Number.isFinite(horizontalRange) ? Math.max(0, horizontalRange) : 0;
  const height = Number.isFinite(verticalRange) ? Math.max(0, verticalRange) : 0;
  const phase = amount * Math.PI * 8;
  const x = -width * (1 - Math.cos(phase)) / 2;
  return {
    x: x === 0 ? 0 : x,
    y: Math.max(0, Math.min(height, amount * height + Math.sin(phase) * Math.min(16, height / 16))),
  };
}

/** A bounded spring step shared by DOM, native, and canvas hosts. Delta is seconds. */
export function stepPetSpring(state: SpringState, target: number, delta: number): SpringState {
  if (!Number.isFinite(target) || !Number.isFinite(delta)) return state;
  const dt = Math.min(.064, Math.max(0, delta));
  const steps = Math.max(1, Math.ceil(dt * 120));
  const step = dt / steps;
  let { position, velocity } = state;
  const { stiffness, damping, mass } = motion.spring;
  for (let index = 0; index < steps; index++) {
    velocity += ((target - position) * stiffness - velocity * damping) / mass * step;
    position += velocity * step;
  }
  return { position, velocity };
}
