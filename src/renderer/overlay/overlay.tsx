import { useEffect, useState } from "react";
import type { JSX } from "react";
import type { OverlayWindowApi } from "../../shared/api";
import type { CaptureState } from "../../shared/capture";
import { INITIAL_CAPTURE_STATE } from "../../shared/capture";
import { Waveform } from "./Waveform";
import "./overlay.css";

const BAR_COUNT = 32;

/** Simulated levels until Phase 2 feeds real analyser data. */
const simulateBands = (): number[] => {
  const now = Date.now();
  return Array.from({ length: BAR_COUNT }, (_, i) => {
    const wave = Math.sin(now / 260 + i * 0.55);
    const noise = Math.sin(now / 97 + i * 1.7) * 0.5;
    return Math.min(1, Math.max(0.05, 0.18 + (wave + noise) * 0.25));
  });
};

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;

function ListeningView({
  state,
  realBands
}: {
  readonly state: Extract<CaptureState, { phase: "listening" }>;
  readonly realBands: readonly number[] | null;
}): JSX.Element {
  const [syntheticBands, setSyntheticBands] = useState<number[]>(() => simulateBands());
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const levelTimer = setInterval(() => { setSyntheticBands(simulateBands()); }, 50);
    const clock = setInterval(() => {
      setElapsedMs(Date.now() - state.startedAtMs);
    }, 100);
    return () => {
      clearInterval(levelTimer);
      clearInterval(clock);
    };
  }, [state.startedAtMs]);

  const bands = realBands !== null ? Array.from(realBands) : syntheticBands;

  return (
    <div className="flex w-full items-center justify-center gap-3 px-6">
      <div className="h-10 w-44">
        <Waveform bands={bands} />
      </div>
      <span className="text-xs text-text-secondary" data-numeric>
        {(elapsedMs / 1000).toFixed(1)}s
      </span>
    </div>
  );
}

function TranscribingView({ engineId }: { readonly engineId: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="shimmer-line" aria-hidden="true" />
      <span className="text-2xs uppercase tracking-wide text-text-muted">
        {engineId} transcribing
      </span>
    </div>
  );
}

function DeliveringView({ text }: { readonly text: string }): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2">
      <svg
        viewBox="0 0 24 24"
        className="h-6 w-6 text-[var(--color-state-delivered)]"
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
      <span className="max-w-[280px] truncate text-sm text-text-secondary">
        {truncate(text, 40)}
      </span>
    </div>
  );
}

function ErrorView({ state }: { readonly state: Extract<CaptureState, { phase: "error" }> }): JSX.Element {
  return (
    <div className="flex max-w-[320px] flex-col items-center gap-1 px-6 text-center">
      <span className="text-sm text-[var(--color-state-error)]">{state.message}</span>
      {state.text !== null && (
        <span className="text-xs text-text-muted">Copied, press Ctrl+V.</span>
      )}
    </div>
  );
}

/**
 * The capture pill. 360x88, seen dozens of times a day; the nicest surface in
 * the app. Surfaces are paper on linen: --color-surface at full opacity, no
 * glass, no blur, one hairline, one float shadow.
 */
export function Overlay(): JSX.Element | null {
  const [state, setState] = useState<CaptureState>(INITIAL_CAPTURE_STATE);
  const [realBands, setRealBands] = useState<readonly number[] | null>(null);

  useEffect(() => {
    // This renderer only ever runs inside the overlay window (its preload
    // exposes windowKind "overlay"), so the union narrows by construction.
    const api = window.struqVoice as OverlayWindowApi;
    const unsubscribeState = api.onCaptureStateChanged(setState);
    const unsubscribeLevels = api.onCaptureLevelsChanged((data) => {
      setRealBands(data.bands);
    });
    return () => {
      unsubscribeState();
      unsubscribeLevels();
    };
  }, []);

  if (state.phase === "idle") return null;

  return (
    <div className="flex h-[88px] w-[360px] items-center justify-center overflow-hidden rounded-full border border-border bg-surface shadow-float">
      {state.phase === "listening" && (
        <ListeningView state={state} realBands={realBands} />
      )}
      {state.phase === "transcribing" && <TranscribingView engineId={state.engineId} />}
      {state.phase === "delivering" && <DeliveringView text={state.text} />}
      {state.phase === "error" && <ErrorView state={state} />}
      {state.phase === "arming" && (
        <span className="text-sm text-text-secondary">Starting\u2026</span>
      )}
    </div>
  );
}
