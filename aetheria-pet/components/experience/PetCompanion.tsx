import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ArrowUpRight, Moon, Sun } from "lucide-react";
import AetheriaPet from "../../pets/aetheria/AetheriaPet";
import type { AetheriaPetHandle } from "../../pets/aetheria/AetheriaPet";
import { getPetScrollPath, stepPetSpring } from "../../pets/aetheria/dynamics";
import type { SpringState } from "../../pets/aetheria/dynamics";
import { boopReaction, motion, scrollEmotion } from "../../pets/aetheria/emotions";
import type { PetEmotion } from "../../pets/aetheria/emotions";
import { GUIDE_EVENT, isGuideEvent } from "../../lib/experience";

const chapters = [
  { selector: ".exp-hero", line: "Hey, I'm Aetheria. You scroll. I'll come along." },
  { selector: "#playground", line: "Press play. I want to see what we make." },
  { selector: ".exp-manifesto", line: "Less talking. More tiny star supervision." },
  { selector: "#workspaces", line: "A whole workspace. I call dibs on the window seat." },
  { selector: "#compare", line: "The competition? Let me put on my serious face." },
  { selector: ".exp-connections", line: "All my tools in one place. Cosmic efficiency." },
  { selector: "#get-started", line: "Take me home? I'll fit in your taskbar." },
  { selector: ".exp-footer", line: "We made it. You scroll. I sparkle." },
];

type Props = {
  pathname: string;
  guideOpen: boolean;
  onGuide: () => void;
  guideTrigger: RefObject<HTMLButtonElement>;
};

export default function PetCompanion({ pathname, guideOpen, onGuide, guideTrigger }: Props) {
  const [emotion, setEmotion] = useState<PetEmotion>("curious");
  const [line, setLine] = useState(chapters[0].line);
  const [speaking, setSpeaking] = useState(true);
  const [napping, setNapping] = useState(false);
  const [reactionKey, setReactionKey] = useState(0);
  const [chapterNumber, setChapterNumber] = useState(1);
  const actor = useRef<AetheriaPetHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const position = useRef<{ x: SpringState; y: SpringState } | null>(null);
  const reacting = useRef(false);
  const taps = useRef({ count: 0, time: 0 });
  const reactionTimer = useRef<ReturnType<typeof setTimeout>>();
  const bubbleTimer = useRef<ReturnType<typeof setTimeout>>();
  const sleepTimer = useRef<ReturnType<typeof setTimeout>>();

  const say = useCallback((text: string, duration = 4200) => {
    clearTimeout(bubbleTimer.current);
    setLine(text);
    setSpeaking(true);
    bubbleTimer.current = setTimeout(() => setSpeaking(false), duration);
  }, []);
  const react = useCallback((mood: PetEmotion, text: string, duration: number) => {
    clearTimeout(reactionTimer.current);
    reacting.current = true;
    setEmotion(mood);
    setReactionKey((key) => key + 1);
    say(text);
    reactionTimer.current = setTimeout(() => {
      reacting.current = false;
      setEmotion("curious");
    }, duration);
  }, [say]);
  function boop() {
    if (napping) { setNapping(false); return; }
    const now = performance.now();
    taps.current = { count: now - taps.current.time < 1600 ? taps.current.count + 1 : 1, time: now };
    const reaction = boopReaction(taps.current.count);
    react(reaction.emotion, reaction.message, reaction.durationMs);
  }

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const compact = window.matchMedia("(max-width: 700px)");
    let frame = 0;
    let previousY = window.scrollY;
    let previousTime = performance.now();
    let springY = position.current?.y ?? {
      position: compact.matches ? window.innerHeight - 208 - Math.min(120, window.innerHeight * .15) : 154,
      velocity: 0,
    };
    let springX = position.current?.x ?? { position: 0, velocity: 0 };
    let petWidth = host.getBoundingClientRect().width;
    let frameTime = 0;
    let lastScroll = 0;
    let speed = 0;
    let chapter = -1;
    let lastMood: PetEmotion = "curious";
    const stops = pathname === "/" ? chapters.flatMap((entry) => {
      const element = document.querySelector(entry.selector);
      return element ? [{ element, line: entry.line }] : [];
    }) : [];

    function wake() {
      clearTimeout(sleepTimer.current);
      if (!reacting.current && !napping) {
        lastMood = "curious";
        setEmotion("curious");
      }
      if (!napping && !guideOpen) sleepTimer.current = setTimeout(() => {
        if (!reacting.current) setEmotion("sleepy");
      }, motion.sleepyAfterMs);
    }
    function update(now: number) {
      frame = 0;
      if (!host || document.hidden) return;
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const progress = maxScroll === 0 ? 0 : Math.min(1, Math.max(0, window.scrollY / maxScroll));
      const stationary = reduced.matches || napping || guideOpen || pathname !== "/";
      const travel = compact.matches ? Math.min(120, window.innerHeight * .15) : Math.max(0, window.innerHeight - 386);
      const base = compact.matches ? window.innerHeight - 208 - travel : 154;
      const viewportWidth = document.documentElement.clientWidth;
      const horizontalRange = Math.max(0, Math.min(viewportWidth - petWidth - 32, viewportWidth * (compact.matches ? .4 : .34)));
      const path = getPetScrollPath(progress, horizontalRange, travel);
      const targetY = stationary ? window.innerHeight - (compact.matches ? 202 : 220) : base + path.y;
      const targetX = stationary ? 0 : path.x;
      const elapsed = Math.min(64, Math.max(1, now - (frameTime || now - 16)));
      frameTime = now;
      springY = stepPetSpring(springY, targetY, elapsed / 1000);
      springX = stepPetSpring(springX, targetX, elapsed / 1000);
      position.current = { x: springX, y: springY };
      const moving = now - lastScroll < 150;
      const renderedX = Math.max(-(viewportWidth - petWidth - 24), Math.min(0, springX.position));
      host.style.transform = `translate3d(${reduced.matches ? 0 : renderedX.toFixed(2)}px, ${reduced.matches ? targetY : springY.position}px, 0)`;
      // Keep the speech bubble inside the phone viewport while its character crosses left.
      const bubbleWidth = Math.min(232, viewportWidth - 32);
      const bubbleLeft = viewportWidth - 8 + renderedX - 6 - bubbleWidth;
      host.style.setProperty("--pet-bubble-offset", `${Math.max(0, 16 - bubbleLeft).toFixed(2)}px`);
      actor.current?.setTravelVelocity(stationary ? 0 : springX.velocity / 240 + (moving ? speed * .2 : 0));
      if (!reacting.current && !napping && !guideOpen) {
        const mood = moving ? scrollEmotion(speed) : "curious";
        if (mood !== lastMood) { lastMood = mood; setEmotion(mood); }
      }
      if (Math.abs(targetY - springY.position) > .2 || Math.abs(springY.velocity) > 2 ||
        Math.abs(targetX - springX.position) > .2 || Math.abs(springX.velocity) > 2 || moving)
        frame = requestAnimationFrame(update);
    }
    function schedule() {
      if (!frame && !document.hidden) frame = requestAnimationFrame(update);
    }
    function resize() {
      petWidth = host?.getBoundingClientRect().width ?? petWidth;
      schedule();
    }
    function scroll() {
      const now = performance.now();
      speed = (window.scrollY - previousY) / Math.max(16, now - previousTime);
      previousY = window.scrollY;
      previousTime = now;
      lastScroll = now;
      wake();
      if (!guideOpen && !napping && stops.length) {
        const next = stops.reduce((active, stop, index) =>
          stop.element.getBoundingClientRect().top < window.innerHeight * .55 ? index : active, 0);
        if (next !== chapter) { chapter = next; setChapterNumber(next + 1); say(stops[next].line); }
      }
      schedule();
    }
    function visibility() {
      host?.setAttribute("data-pet-paused", String(document.hidden || napping));
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; clearTimeout(sleepTimer.current); }
      else { frameTime = 0; wake(); schedule(); }
    }
    function receive(event: Event) {
      if (!(event instanceof CustomEvent) || napping) return;
      const detail: unknown = event.detail;
      if (!isGuideEvent(detail)) return;
      if (detail.kind === "completed") react("proud", "We made a thing! Extremely proud star moment.", 2600);
      if (detail.kind === "started") react("excited", "It's happening. Nobody panic. Especially me.", 2200);
      if (detail.kind === "cancelled") react("curious", "A tactical pause. Even stars need those.", 1600);
    }
    clearTimeout(reactionTimer.current);
    clearTimeout(bubbleTimer.current);
    reacting.current = false;
    setEmotion(napping ? "sleepy" : "curious");
    setSpeaking(false);
    if (pathname === "/" && !napping && !guideOpen) scroll();
    visibility();
    schedule();
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("resize", resize);
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    window.addEventListener(GUIDE_EVENT, receive);
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", schedule);
    compact.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(sleepTimer.current);
      clearTimeout(reactionTimer.current);
      clearTimeout(bubbleTimer.current);
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener(GUIDE_EVENT, receive);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", schedule);
      compact.removeEventListener("change", schedule);
    };
  }, [pathname, napping, guideOpen, react, say]);

  return (
    <>
      <div className={`pet-companion ${napping ? "is-napping" : ""} ${guideOpen ? "is-guiding" : ""}`} ref={root}>
        {speaking && !guideOpen && !napping && <div className="pet-speech" key={line}>
          <div className="pet-speech-heading"><span><i /> Aetheria</span><span>{String(chapterNumber).padStart(2, "0")} / {String(chapters.length).padStart(2, "0")}</span></div>
          <p>{line}</p>
        </div>}
        <AetheriaPet ref={actor} emotion={emotion} reactionKey={reactionKey} onBoop={boop} paused={napping}
          onGreet={() => { if (!reacting.current && !napping && !guideOpen) react("love", "Oh, hi. The orbit ring? Personal space.", 1500); }} />
        <div className="pet-controls">
          <button type="button" ref={guideTrigger} aria-expanded={guideOpen} aria-controls="aetheria-guide-panel" onClick={onGuide}>
            {guideOpen ? "Close" : "Guide"}<ArrowUpRight size={12} />
          </button>
          <button type="button" aria-label={napping ? "Wake Aetheria" : "Let Aetheria nap and pause animations"} aria-pressed={napping} onClick={() => setNapping(!napping)}>
            {napping ? <Sun size={14} /> : <Moon size={13} />}
          </button>
        </div>
      </div>
    </>
  );
}
