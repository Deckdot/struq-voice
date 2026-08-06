import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@iconify/react";
import type { OverlayWindowApi } from "../../shared/api";
import type { CaptureState } from "../../shared/capture";
import { INITIAL_CAPTURE_STATE } from "../../shared/capture";
import { Waveform } from "./Waveform";
import { useDragPanel } from "./useDragPanel";

const BAR_COUNT = 32;
const SILENT_BANDS: readonly number[] = Array.from({ length: BAR_COUNT }, () => 0);

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${String(seconds)}s`;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
};

function StateDot({ state }: { readonly state: "arming" | "listening" | "transcribing" | "error" }): JSX.Element {
  const color =
    state === "listening"
      ? "var(--sv-success)"
      : state === "transcribing"
        ? "var(--sv-info)"
        : state === "error"
          ? "var(--sv-danger)"
          : "var(--sv-accent)";
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      {state === "listening" && (
        <span className="absolute inset-0 rounded-pill bg-success opacity-40 motion-safe:animate-ping" />
      )}
      <span className="relative h-full w-full rounded-pill" style={{ backgroundColor: color }} />
    </span>
  );
}

/**
 * The capture panel. Plain words, no jargon. The pill morphs between
 * five states: arming, listening, transcribing, delivering, error. The
 * waveform decays into a thin processing line during transcribing, so
 * the user sees the audio being worked on without a generic spinner.
 */
export function Overlay(): JSX.Element | null {
  const api = window.struqVoice as OverlayWindowApi;
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [bands, setBands] = useState<readonly number[] | null>(null);
  const [partial, setPartial] = useState("");
  const [liveEnabled, setLiveEnabled] = useState(false);
  const [decayMs, setDecayMs] = useState<number | null>(null);
  const sequenceRef = useRef(0);
  const previousPhase = useRef<string>("idle");

  const drag = useDragPanel(api.move);

  useEffect(() => {
    const unsubscribeState = api.onCaptureStateChanged((next, live) => {
      const nextPhase = next.phase;
      const prevPhase = previousPhase.current;
      if (nextPhase === "transcribing" && prevPhase !== "transcribing") {
        // Start the bar decay. When transcribing is done, decayMs goes back to null.
        setDecayMs(280);
      } else if (nextPhase !== "transcribing") {
        setDecayMs(null);
      }
      previousPhase.current = nextPhase;
      setState(next);
      setLiveEnabled(live);
    });
    const unsubscribeLevels = api.onCaptureLevelsChanged((data) => {
      setBands(data.bands);
    });
    const unsubscribePartial = api.onPartialTranscript((data) => {
      if (data.sequence < sequenceRef.current) return;
      sequenceRef.current = data.sequence;
      setPartial(data.text);
    });
    return () => {
      unsubscribeState();
      unsubscribeLevels();
      unsubscribePartial();
    };
  }, [api]);

  // A new capture starts from a clean slate.
  useEffect(() => {
    if (state.phase === "arming" || state.phase === "idle") {
      sequenceRef.current = 0;
      setPartial("");
    }
    if (state.phase === "idle") {
      setBands(null);
    }
  }, [state.phase]);

  if (state.phase === "idle") return null;

  return (
    <div
      onPointerDown={drag.onPointerDown}
      className="panel-enter flex h-full w-full cursor-grab flex-col gap-2 overflow-hidden rounded-lg border border-border bg-surface px-3 py-2 shadow-float active:cursor-grabbing"
    >
      <AnimatePresence mode="wait" initial={false}>
        {state.phase === "arming" && (
          <motion.div
            key="arming"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="flex min-h-0 flex-1 items-center gap-2.5"
          >
            <StateDot state="arming" />
            <div className="h-5 min-w-0 flex-1">
              <Waveform bands={SILENT_BANDS} idle />
            </div>
            <span className="shrink-0 text-2xs text-text-muted">Starting...</span>
          </motion.div>
        )}

        {state.phase === "listening" && (
          <ListeningView
            key="listening"
            state={state}
            bands={bands}
            partial={partial}
            liveEnabled={liveEnabled}
          />
        )}

        {state.phase === "transcribing" && (
          <TranscribingView
            key="transcribing"
            engineId={state.engineId}
            partial={partial}
            liveEnabled={liveEnabled}
            bands={bands}
            decayMs={decayMs}
          />
        )}

        {state.phase === "delivering" && <DeliveringView key="delivering" />}

        {state.phase === "error" && <ErrorView key="error" state={state} />}
      </AnimatePresence>
    </div>
  );
}

function ListeningView({
  state,
  bands,
  partial,
  liveEnabled
}: {
  readonly state: Extract<CaptureState, { phase: "listening" }>;
  readonly bands: readonly number[] | null;
  readonly partial: string;
  readonly liveEnabled: boolean;
}): JSX.Element {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(Date.now() - state.startedAtMs);
    const clock = window.setInterval(() => {
      setElapsedMs(Date.now() - state.startedAtMs);
    }, 100);
    return () => {
      window.clearInterval(clock);
    };
  }, [state.startedAtMs]);

  const live = bands !== null;

  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <StateDot state="listening" />
        <div className="h-5 min-w-0 flex-1">
          <Waveform bands={bands ?? SILENT_BANDS} idle={!live} />
        </div>
        <span className="shrink-0 text-2xs text-text-muted tabular-nums" data-numeric>
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      {liveEnabled && (
        <div className="transcript-scroll min-h-0 flex-1 overflow-y-auto rounded-sm bg-bg-sunken px-2.5 py-1.5">
          {partial.length > 0 ? (
            <p className="text-2xs leading-relaxed text-text">{partial}</p>
          ) : (
            <p className="text-2xs text-text-muted">Listening...</p>
          )}
        </div>
      )}
    </>
  );
}

function TranscribingView({
  engineId,
  partial,
  liveEnabled,
  bands,
  decayMs
}: {
  readonly engineId: string;
  readonly partial: string;
  readonly liveEnabled: boolean;
  readonly bands: readonly number[] | null;
  readonly decayMs: number | null;
}): JSX.Element {
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <StateDot state="transcribing" />
        <div className="min-w-0 flex-1">
          {/* The bars are the same canvas; they decay in place via the Waveform's
              decayMs prop, then the shimmer line is laid on top with CSS. */}
          <div className="relative h-5">
            <Waveform bands={bands ?? SILENT_BANDS} idle decayMs={decayMs} />
            <div className="shimmer-line absolute inset-0" aria-hidden="true" />
          </div>
        </div>
        <span className="shrink-0 text-2xs uppercase tracking-wide text-text-muted">
          {engineId}
        </span>
      </div>
      {liveEnabled && (
        <div className="transcript-scroll min-h-0 flex-1 overflow-y-auto rounded-sm bg-bg-sunken px-2.5 py-1.5">
          {partial.length > 0 ? (
            <p className="text-2xs leading-relaxed text-text">{partial}</p>
          ) : (
            <p className="text-2xs text-text-muted">Working on the transcript...</p>
          )}
        </div>
      )}
    </>
  );
}

function DeliveringView(): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="flex min-h-0 flex-1 items-center justify-center"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4 shrink-0 text-success"
        aria-hidden="true"
      >
        <path
          d="M4 12.5l5 5L20 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="checkmark-draw"
        />
      </svg>
    </motion.div>
  );
}

function ErrorView({ state }: { readonly state: Extract<CaptureState, { phase: "error" }> }): JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center gap-2.5">
      <StateDot state="error" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-danger">{state.message}</p>
        {state.text !== null && state.text.length > 0 && (
          <p className="truncate text-2xs text-text-muted">Copied. Press Ctrl + V to paste.</p>
        )}
      </div>
      <Icon icon="ph:warning-circle" className="h-3.5 w-3.5 text-danger" aria-hidden="true" />
    </div>
  );
}
