import type { JSX } from "react";
import { useMainStore } from "../store/use-main-store";

const PHASE_HINTS: Record<string, { label: string; detail: string }> = {
  idle: { label: "Idle", detail: "Hold Ctrl+Space anywhere in Windows and speak." },
  arming: { label: "Warming up", detail: "The microphone is reconnecting." },
  listening: { label: "Listening", detail: "Speak. Release to transcribe." },
  transcribing: { label: "Transcribing", detail: "Hearing the words back." },
  delivering: { label: "Delivered", detail: "The text is in the focused window." },
  error: { label: "Something went wrong", detail: "See the tray or Settings for guidance." }
};

const FALLBACK_HINT = PHASE_HINTS["idle"] as { label: string; detail: string };

/**
 * The Dictate view: the current capture state and the one-line instruction.
 * The capture pill lives on screen; this view is the quieter home base.
 */
export function DictateView(): JSX.Element {
  const capture = useMainStore((state) => state.capture);
  const hint = PHASE_HINTS[capture.phase] ?? FALLBACK_HINT;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-8">
      <h1 className="font-serif text-display tracking-tight text-text">Struq Voice</h1>
      <p className="max-w-md text-center text-base leading-snug text-text-muted">
        {hint.detail}
      </p>
      <span className="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 font-mono text-2xs uppercase tracking-wide text-text-muted">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            capture.phase === "listening"
              ? "bg-state-listening"
              : capture.phase === "transcribing"
                ? "bg-state-transcribing"
                : "bg-state-idle"
          }`}
          aria-hidden="true"
        />
        {hint.label}
      </span>
    </div>
  );
}
