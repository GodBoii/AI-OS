export type GuideEvent =
  | { kind: "selected"; name: string }
  | { kind: "started"; name: string }
  | { kind: "completed"; name: string }
  | { kind: "cancelled" }
  | { kind: "guide" };

export const GUIDE_EVENT = "aetheria:experience";

export function notifyGuide(event: GuideEvent) {
  window.dispatchEvent(
    new CustomEvent<GuideEvent>(GUIDE_EVENT, { detail: event }),
  );
}

export function isGuideEvent(value: unknown): value is GuideEvent {
  if (typeof value !== "object" || value === null || !("kind" in value))
    return false;
  if (value.kind === "guide" || value.kind === "cancelled") return true;
  return (
    (value.kind === "selected" ||
      value.kind === "started" ||
      value.kind === "completed") &&
    "name" in value &&
    typeof value.name === "string"
  );
}
