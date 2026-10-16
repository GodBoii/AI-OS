import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { emotions, STAR_PATH } from "./emotions";
import type { PetEmotion } from "./emotions";
import type { PetRenderer } from "./renderer";

export type AetheriaPetHandle = Pick<PetRenderer, "lookAt" | "setTravelVelocity">;

export type AetheriaPetProps = {
  emotion?: PetEmotion;
  /** Increment to replay a tap animation, even when the emotion stays the same. */
  reactionKey?: number;
  onBoop: () => void;
  onGreet?: () => void;
  className?: string;
  style?: CSSProperties;
  paused?: boolean;
};

/** Character only. No router, scrolling, storage, or website dependencies. */
const AetheriaPet = forwardRef<AetheriaPetHandle, AetheriaPetProps>(function AetheriaPet({
  emotion = "curious", reactionKey = 0, onBoop, onGreet,
  className = "", style, paused = false,
}, ref) {
  const id = useId().replace(/:/g, "");
  const face = emotions[emotion];
  const host = useRef<HTMLSpanElement>(null);
  const renderer = useRef<PetRenderer | null>(null);
  const latest = useRef({ emotion, reactionKey, paused, onGreet });
  latest.current = { emotion, reactionKey, paused, onGreet };
  const greetTimer = useRef<ReturnType<typeof setTimeout>>();
  const [ready, setReady] = useState(false);
  useImperativeHandle(ref, () => ({
    lookAt: (x, y) => renderer.current?.lookAt(x, y),
    setTravelVelocity: (speed) => renderer.current?.setTravelVelocity(speed),
  }), []);
  useEffect(() => {
    let cancelled = false;
    async function setup() {
      const { createPetRenderer } = await import("./renderer");
      if (cancelled || !host.current) return;
      const instance = createPetRenderer(host.current, (value) => { if (!cancelled) setReady(value); });
      renderer.current = instance;
      instance?.setEmotion(latest.current.emotion);
      instance?.setPaused(latest.current.paused);
      setReady(Boolean(instance));
    }
    void setup().catch(() => { if (!cancelled) setReady(false); });
    return () => { cancelled = true; clearTimeout(greetTimer.current); renderer.current?.dispose(); renderer.current = null; };
  }, []);
  useEffect(() => { renderer.current?.setEmotion(emotion, reactionKey > 0); }, [emotion, reactionKey]);
  useEffect(() => { renderer.current?.setPaused(paused); }, [paused]);
  return (
    <button
      type="button"
      className={`aetheria-pet ${ready ? "is-3d" : ""} ${className}`}
      data-emotion={emotion}
      data-renderer={ready ? "webgl" : "svg"}
      data-paused={paused}
      style={{ ...style, color: face.accent }}
      onClick={onBoop}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") greetTimer.current = setTimeout(() => latest.current.onGreet?.(), 650);
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== "mouse") return;
        const bounds = event.currentTarget.getBoundingClientRect();
        renderer.current?.lookAt((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
      }}
      onPointerLeave={() => { clearTimeout(greetTimer.current); renderer.current?.lookAt(0, 0); }}
      aria-label={`Boop Aetheria. ${face.label}.`}
    >
      <span className="aetheria-pet-flight" aria-hidden="true">
        <span className="aetheria-pet-speed"><i /><i /><i /></span>
        <span className="aetheria-pet-webgl" ref={host} />
        <span className="aetheria-pet-reaction" key={reactionKey}>
          <svg className="aetheria-pet-art" viewBox="-12 -12 124 124" fill="none">
            <defs>
              <linearGradient id={`${id}-metal`} x1="22" y1="15" x2="75" y2="90" gradientUnits="userSpaceOnUse">
                <stop stopColor="#fff" /><stop offset=".28" stopColor="#f1f6e8" />
                <stop offset=".48" stopColor="#d5f49d" /><stop offset=".65" stopColor="#a3b586" />
                <stop offset=".82" stopColor="#edf8d9" /><stop offset="1" stopColor="#697653" />
              </linearGradient>
              <linearGradient id={`${id}-ring`} x1="20" y1="12" x2="80" y2="85" gradientUnits="userSpaceOnUse">
                <stop stopColor="#efffd3" /><stop offset=".5" stopColor="#6e8250" />
                <stop offset="1" stopColor="#d5f49d" />
              </linearGradient>
            </defs>
            <g className="aetheria-pet-orbit">
              <ellipse cx="50" cy="50" rx="39" ry="29" transform="rotate(-32 50 50)" stroke={`url(#${id}-ring)`} strokeWidth="1.2" />
              <circle className="aetheria-pet-moon" cx="17" cy="70" r="3" fill="currentColor" />
            </g>
            <g className="aetheria-pet-body">
              <path d={STAR_PATH} transform="translate(0 3)" fill="#53643d" />
              <path d={STAR_PATH} fill={`url(#${id}-metal)`} stroke="#f3ffdb" strokeWidth=".6" />
              <path d="M50 7c-2 29-12 38-40 43 28-2 38-7 42-14Z" fill="white" opacity=".22" />
              <g className="aetheria-pet-face" stroke="#192211" strokeWidth="3.1" strokeLinecap="round" strokeLinejoin="round">
                <g className="aetheria-pet-eyes">
                  <path d={face.leftEye} fill={emotion === "love" ? "#192211" : "none"} />
                  <path d={face.rightEye} fill={emotion === "love" ? "#192211" : "none"} />
                </g>
                <path d={face.mouth} strokeWidth="2" fill={emotion === "excited" || emotion === "zooming" ? "#192211" : "none"} />
              </g>
              <g className="aetheria-pet-blush" fill="#db8c83" opacity=".55">
                <ellipse cx="35" cy="55" rx="3.5" ry="1.5" /><ellipse cx="65" cy="55" rx="3.5" ry="1.5" />
              </g>
            </g>
          </svg>
          <span className="aetheria-pet-satellites"><i>✦</i><i>✦</i><i>✦</i></span>
          <span className="aetheria-pet-heart">♡</span>
          <span className="aetheria-pet-zzz">z z Z</span>
        </span>
      </span>
      <span className="aetheria-pet-shadow" aria-hidden="true" />
    </button>
  );
});

export default AetheriaPet;
