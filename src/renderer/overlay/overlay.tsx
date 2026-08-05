import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
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

/** The dot that names the current phase, in the phase's own state colour. */
function StatusDot({ tone }: { readonly tone: string }): JSX.Element {
  return (
    <span
      className="h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ backgroundColor: `var(${tone})` }}
      aria-hidden="true"
    />
  );
}

/**
 * The running transcript. Provisional by nature: it comes from re-decoding the
 * audio so far, so it is set in the interface sans rather than the reading
 * serif, which the design system reserves for a settled transcript.
 */
function TranscriptBox({
  text,
  placeholder
}: {
  readonly text: string;
  readonly placeholder: string;
}): JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return;
    // Pin to the newest words. A long dictation would otherwise leave the user
    // reading the beginning of what they said.
    element.scrollTop = element.scrollHeight;
  }, [text]);

  return (
    <div
      ref={scrollRef}
      data-selectable
      className="transcript-scroll min-h-0 flex-1 overflow-y-auto rounded-md bg-bg-sunken px-2.5 py-1.5"
    >
      {text.length > 0 ? (
        <p className="text-xs leading-relaxed text-text">{text}</p>
      ) : (
        <p className="text-xs text-text-muted">{placeholder}</p>
      )}
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
    const clock = setInterval(() => {
      setElapsedMs(Date.now() - state.startedAtMs);
    }, 100);
    return () => {
      clearInterval(clock);
    };
  }, [state.startedAtMs]);

  const live = bands !== null;

  return (
    <>
      {/* One row: state dot, waveform, timer. At this height there is no room
          for a stacked header, and none is needed. */}
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <StatusDot tone="--color-state-listening" />
        <div className="h-5 min-w-0 flex-1">
          <Waveform bands={bands ?? SILENT_BANDS} idle={!live} />
        </div>
        <span className="shrink-0 text-2xs text-text-muted" data-numeric>
          {formatElapsed(elapsedMs)}
        </span>
      </div>
      {liveEnabled && (
        <TranscriptBox text={partial} placeholder="Listening…" />
      )}
    </>
  );
}

function TranscribingView({
  engineId,
  partial,
  liveEnabled
}: {
  readonly engineId: string;
  readonly partial: string;
  readonly liveEnabled: boolean;
}): JSX.Element {
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <StatusDot tone="--color-state-transcribing" />
        <div className="min-w-0 flex-1">
          <div className="shimmer-line w-full" aria-hidden="true" />
        </div>
        <span className="shrink-0 text-2xs uppercase tracking-wide text-text-muted">
          {engineId}
        </span>
      </div>
      {liveEnabled && (
        <TranscriptBox text={partial} placeholder="Working on the transcript…" />
      )}
    </>
  );
}

function DeliveringView({ text }: { readonly text: string }): JSX.Element {
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-[var(--color-state-delivered)]"
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
        <p className="min-w-0 flex-1 truncate text-xs text-text-secondary">{text}</p>
      </div>
    </>
  );
}

function ErrorView({
  state
}: {
  readonly state: Extract<CaptureState, { phase: "error" }>;
}): JSX.Element {
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <StatusDot tone="--color-state-error" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-[var(--color-state-error)]">{state.message}</p>
          {state.text !== null && (
            <p className="truncate text-2xs text-text-muted">Copied, press Ctrl+V.</p>
          )}
        </div>
      </div>
    </>
  );
}

function ArmingView(): JSX.Element {
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center gap-2.5">
        <StatusDot tone="--color-state-listening" />
        <div className="h-5 min-w-0 flex-1">
          <Waveform bands={SILENT_BANDS} idle />
        </div>
      </div>
    </>
  );
}

/**
 * The capture panel. Seen dozens of times a day, so it is the surface that has
 * to feel best. Paper on linen per the design system: --color-surface at full
 * opacity, no glass, no blur, one hairline, one float shadow.
 *
 * The window cannot take focus (paste delivery depends on it), so the panel is
 * dragged by hand from the header. Nothing here can be clicked into.
 */
export function Overlay(): JSX.Element | null {
  const api = window.struqVoice as OverlayWindowApi;
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [bands, setBands] = useState<readonly number[] | null>(null);
  const [partial, setPartial] = useState("");
  const [liveEnabled, setLiveEnabled] = useState(false);
  const sequenceRef = useRef(0);

  const drag = useDragPanel(api.move);

  useEffect(() => {
    const unsubscribeState = api.onCaptureStateChanged((next, live) => {
      setState(next);
      setLiveEnabled(live);
    });
    const unsubscribeLevels = api.onCaptureLevelsChanged((data) => {
      setBands(data.bands);
    });
    const unsubscribePartial = api.onPartialTranscript((data) => {
      // Partials can arrive out of order when a decode runs long; only ever
      // move forward.
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

  // A new capture starts from a clean slate: last session's words must never
  // read as this session's.
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
      className="panel-enter flex h-full w-full cursor-grab flex-col gap-1.5 overflow-hidden rounded-lg border border-border bg-surface px-3 py-2 shadow-float active:cursor-grabbing"
    >
      {state.phase === "arming" && <ArmingView />}
      {state.phase === "listening" && (
        <ListeningView
          state={state}
          bands={bands}
          partial={partial}
          liveEnabled={liveEnabled}
        />
      )}
      {state.phase === "transcribing" && (
        <TranscribingView
          engineId={state.engineId}
          partial={partial}
          liveEnabled={liveEnabled}
        />
      )}
      {state.phase === "delivering" && <DeliveringView text={state.text} />}
      {state.phase === "error" && <ErrorView state={state} />}
    </div>
  );
}
