import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  ArrowRight,
  ArrowUpRight,
  ChevronLeft,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { GUIDE_EVENT, isGuideEvent } from "../../lib/experience";
import StarMark from "./StarMark";
import PetCompanion from "./PetCompanion";

const welcome =
  "I’m your little wayfinder. Want to watch a task take shape, explore the workspace, or find your download?";
const pageGuidance: Readonly<Record<string, string>> = {
  "/download":
    "Choose the client for your platform. The download rows show versions, package formats, and requirements. macOS is listed as coming soon.",
  "/pricing":
    "Core has a daily token allowance. Pro and Elite list monthly allowances. Paid-plan buttons put you in touch with the team about availability.",
  "/for-you":
    "Select a tool to explore its workflow example. These illustrations explain how connected context can fit into your work.",
  "/auth/login":
    "Sign in with Google or your email. If you need to reset your password, use the link below the password field.",
  "/auth/signup":
    "Create your account with Google or email. Already have an account? Use the sign-in link above the form.",
  "/auth/forgot-password":
    "Enter your account email to request a password reset. The form will show the next step.",
  "/auth/reset-password":
    "Choose a new password for your account, then follow the form to return to your workspace.",
  "/contact":
    "Use the contact links on this page to reach the Aetheria team. I can also take you back to the product examples.",
  "/changelog":
    "Browse the published release notes here. For installers and requirements, open the download page.",
  "/privacy-policy":
    "This page explains Aetheria’s published privacy policy. Use the contact page for questions about your data.",
  "/terms":
    "Read the published terms here. The contact page is the place for questions about them.",
};
const tour = [
  {
    id: "playground",
    message:
      "Start here. Pick an example and run it. You can pause, inspect the source, and download the finished file.",
  },
  {
    id: "workspaces",
    message:
      "These are the different places your work can happen. Select a panel to explore conversation, code, computer tasks, or connected tools.",
  },
  {
    id: "compare",
    message:
      "Choose an assistant to read about its approach. The source links explain its documented capabilities.",
  },
  {
    id: "get-started",
    message:
      "Your next step is a download. Choose your platform, or open the download page for requirements.",
  },
];

export default function Companion() {
  const router = useRouter();
  const isHome = router.pathname === "/";
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(welcome);
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [voice, setVoice] = useState(false);
  const [speechAvailable, setSpeechAvailable] = useState(false);
  const [speechError, setSpeechError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMessage(pageGuidance[router.pathname] ?? welcome);
    setOpen(false);
    setTourStep(null);
    setVoice(false);
    document
      .querySelector(".is-guide-target")
      ?.classList.remove("is-guide-target");
  }, [router.pathname]);

  useEffect(() => {
    setSpeechAvailable("speechSynthesis" in window);
    function receive(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (!isGuideEvent(detail)) return;
      if (detail.kind === "guide") {
        setOpen(true);
        setMessage(welcome);
        setTourStep(null);
        return;
      }
      if (detail.kind === "selected")
        setMessage(
          detail.name +
            " is ready. Press play to see the example. Its output is created locally in your browser.",
        );
      if (detail.kind === "started")
        setMessage(
          "Watch the timeline as " +
            detail.name.toLowerCase() +
            " runs. You can pause it or cancel at any time.",
        );
      if (detail.kind === "completed")
        setMessage(
          "There it is. Your " +
            detail.name.toLowerCase() +
            " example is complete. Open the source or download the file using the controls below the preview.",
        );
      if (detail.kind === "cancelled")
        setMessage("Stopped. Pick another example whenever you’re ready.");
    }
    window.addEventListener(GUIDE_EVENT, receive);
    return () => {
      window.removeEventListener(GUIDE_EVENT, receive);
      document
        .querySelector(".is-guide-target")
        ?.classList.remove("is-guide-target");
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(false);
    }
    window.addEventListener("keydown", key);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("pointerdown", outside);
    };
  }, [open]);

  useEffect(() => {
    if (!speechAvailable) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    if (!voice || !open || document.hidden) return;
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 1.03;
    utterance.lang = "en";
    utterance.onerror = (event) => {
      if (event.error !== "interrupted" && event.error !== "canceled") {
        setSpeechError(true);
        setVoice(false);
      }
    };
    const stopWhenHidden = () => {
      if (document.hidden) synth.cancel();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    synth.speak(utterance);
    return () => {
      synth.cancel();
      document.removeEventListener("visibilitychange", stopWhenHidden);
    };
  }, [message, voice, open, speechAvailable]);

  useEffect(() => {
    if (!open)
      document
        .querySelector(".is-guide-target")
        ?.classList.remove("is-guide-target");
  }, [open]);

  function dismiss() {
    setOpen(false);
    setTourStep(null);
    trigger.current?.focus();
  }
  function visit(index: number) {
    const step = tour[index];
    if (!step) return;
    setTourStep(index);
    setMessage(step.message);
    document
      .querySelector(".is-guide-target")
      ?.classList.remove("is-guide-target");
    const section = document.getElementById(step.id);
    section?.classList.add("is-guide-target");
    section?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }

  return (
    <div className="companion" ref={root}>
      {open && (
        <aside
          id="aetheria-guide-panel"
          className="companion-panel"
          aria-label="Aetheria wayfinder"
        >
          <div className="companion-heading">
            <span>
              <StarMark />
              Your wayfinder
            </span>
            <div>
              {speechAvailable && (
                <button
                  type="button"
                  aria-pressed={voice}
                  aria-label={voice ? "Mute guide voice" : "Enable guide voice"}
                  onClick={() => {
                    setVoice(!voice);
                    setSpeechError(false);
                  }}
                >
                  {voice ? <Volume2 size={16} /> : <VolumeX size={16} />}
                </button>
              )}
              <button type="button" onClick={dismiss} aria-label="Close guide">
                <X size={17} />
              </button>
            </div>
          </div>
          <p aria-live="polite">{message}</p>
          {speechError && (
            <span className="guide-speech-error">
              Voice is unavailable in this browser. Text guidance still works.
            </span>
          )}
          {tourStep === null ? (
            <div className="companion-actions">
              {isHome ? (
                <>
                  <button type="button" onClick={() => visit(0)}>
                    Show me around <ArrowRight size={15} />
                  </button>
                  <a href="#playground" onClick={() => visit(0)}>
                    Take me to the demo <ArrowUpRight size={14} />
                  </a>
                </>
              ) : (
                <Link href="/#playground">
                  Explore the homepage <ArrowUpRight size={14} />
                </Link>
              )}
              <Link href="/download">
                Find my download <ArrowUpRight size={14} />
              </Link>
            </div>
          ) : (
            <div className="companion-tour">
              <button
                type="button"
                disabled={tourStep === 0}
                onClick={() => visit(tourStep - 1)}
                aria-label="Previous tour stop"
              >
                <ChevronLeft size={17} />
              </button>
              <span>
                {tourStep + 1} / {tour.length}
              </span>
              {tourStep === tour.length - 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setTourStep(null);
                    setMessage("You’re all set. Explore at your own pace.");
                    document
                      .querySelector(".is-guide-target")
                      ?.classList.remove("is-guide-target");
                  }}
                >
                  Finish <ArrowUpRight size={15} />
                </button>
              ) : (
                <button type="button" onClick={() => visit(tourStep + 1)}>
                  Next <ArrowRight size={15} />
                </button>
              )}
            </div>
          )}
          <span className="companion-footer">
            {voice
              ? "Voice on. You can mute it anytime."
              : "Quiet by default. Voice is optional."}
          </span>
        </aside>
      )}
      <PetCompanion
        pathname={router.pathname}
        guideOpen={open}
        guideTrigger={trigger}
        onGuide={() => {
          if (open) dismiss();
          else setOpen(true);
        }}
      />
    </div>
  );
}
