/** Platform-independent character data. Coordinates use a 100 × 100 viewBox. */
export const STAR_PATH =
  "M50 2C48 38 38 48 2 50C38 52 48 62 50 98C52 62 62 52 98 50C62 48 52 38 50 2Z";

export const emotions = {
  curious: {
    leftEye: "M42 43v9", rightEye: "M57 43v9",
    mouth: "M47 59q3 3 6 0", label: "Curious", accent: "#d5f49d",
  },
  excited: {
    leftEye: "M39 49q4-9 8 0", rightEye: "M53 49q4-9 8 0",
    mouth: "M45 56q5 10 10 0Z", label: "Excited", accent: "#d5f49d",
  },
  zooming: {
    leftEye: "M38 43l8 4-8 4", rightEye: "M61 43l-8 4 8 4",
    mouth: "M45 56q5 10 10 0Z", label: "Going into orbit", accent: "#d5f49d",
  },
  sleepy: {
    leftEye: "M39 49q4 3 8 0", rightEye: "M53 49q4 3 8 0",
    mouth: "M48 59h4", label: "Napping", accent: "#b8c8e8",
  },
  bonked: {
    leftEye: "M39 43l8 9m0-9-8 9", rightEye: "M53 43l8 9m0-9-8 9",
    mouth: "M46 60q4-5 8 0", label: "Bonked", accent: "#ffc4a2",
  },
  dizzy: {
    leftEye: "M43 47c-3-5-7 2-2 5s9-6 2-10",
    rightEye: "M57 47c-3-5-7 2-2 5s9-6 2-10",
    mouth: "M45 60q3-4 5 0t5 0", label: "Seeing stars", accent: "#ffc4a2",
  },
  love: {
    leftEye: "M43 51l-5-5c-3-4 3-7 5-3 2-4 8-1 5 3Z",
    rightEye: "M57 51l-5-5c-3-4 3-7 5-3 2-4 8-1 5 3Z",
    mouth: "M45 58q5 6 10 0", label: "Feeling loved", accent: "#ffc2d9",
  },
  proud: {
    leftEye: "M39 48q4-6 8 0", rightEye: "M53 48q4-6 8 0",
    mouth: "M45 57q5 6 10 0", label: "Proud of you", accent: "#d5f49d",
  },
} satisfies Record<string, {
  leftEye: string; rightEye: string; mouth: string; label: string; accent: string;
}>;

export type PetEmotion = keyof typeof emotions;

/** Values can also drive a native spring, canvas, or 3D renderer. */
export const motion = {
  spring: { stiffness: 105, damping: 16, mass: 1 },
  bonk: { durationMs: 650, squash: 0.72, stretch: 1.18, tilt: 24 },
  dizzy: { durationMs: 1600, tilt: 18 },
  blink: { durationMs: 160, intervalMs: 4700 },
  idle: { durationMs: 3600, floatPx: 4 },
  sleepyAfterMs: 14000,
};

export function scrollEmotion(speed: number): PetEmotion {
  if (Math.abs(speed) > 1.4) return "zooming";
  if (Math.abs(speed) > 0.12) return "excited";
  return "curious";
}

export function boopReaction(count: number): {
  emotion: PetEmotion; message: string; durationMs: number;
} {
  if (count >= 3) return {
    emotion: "dizzy", message: "I am a star. Why am I seeing other stars?",
    durationMs: motion.dizzy.durationMs,
  };
  return {
    emotion: "bonked",
    message: count === 2 ? "Hey! This face is load-bearing." : "Bonk! My one brain cell bounced.",
    durationMs: motion.bonk.durationMs,
  };
}
