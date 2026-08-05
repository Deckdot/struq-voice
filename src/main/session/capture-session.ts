/**
 * THE capture state machine. One authority, in the main process. Tray,
 * overlay and main window all render from broadcasts of it. Nothing else
 * owns capture state.
 *
 * Phase 1 has no audio and no engines yet: the session runs the full state
 * journey on a simulated transcript so the hotkey -> overlay -> tray loop is
 * real before the audio pipeline lands. Phase 2 injects the audio source,
 * Phase 3 the transcription engine.
 *
 *   idle --arm--> arming --ready--> listening --stop--> transcribing
 *     --ok--> delivering --done (auto 900ms)--> idle
 *
 *   listening --cancel--> idle          (Escape)
 *   listening --fail--> error --auto--> idle
 *   listening --minCaptureMs elapse--> idle (silent discard)
 *   listening --maxCaptureMs elapse--> stop (stuck-key watchdog)
 */

import type { CaptureState } from "../../shared/capture";
import { INITIAL_CAPTURE_STATE } from "../../shared/capture";
import { MOCK_ENGINE_ID } from "../../shared/engines";

export const SIMULATED_TRANSCRIPT =
  "This is a simulated transcript. Hold the hotkey anywhere in Windows and speak.";

export interface CaptureSessionOptions {
  /** Captures shorter than this (ms) are discarded silently. */
  readonly minCaptureMs: number;
  /** Force-stop a capture that ran this long (ms): stuck key, sleep, alt-tab. */
  readonly maxCaptureMs: number;
  /** Simulated inference time between stop and delivering (ms). */
  readonly simulatedInferenceMs: number;
  /** How long delivering stays on screen before returning to idle (ms). */
  readonly deliverHoldMs: number;
  /** How long error stays on screen before returning to idle (ms). */
  readonly errorHoldMs: number;
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureSessionOptions = {
  minCaptureMs: 350,
  maxCaptureMs: 120_000,
  simulatedInferenceMs: 300,
  deliverHoldMs: 900,
  errorHoldMs: 4000
};

export interface CaptureSession {
  readonly state: CaptureState;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  fail: (message: string, text?: string | null) => void;
  subscribe: (listener: (state: CaptureState) => void) => () => void;
}

export const createCaptureSession = (
  options: CaptureSessionOptions
): CaptureSession => {
  let state: CaptureState = INITIAL_CAPTURE_STATE;
  const listeners = new Set<(state: CaptureState) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let startedAt: number | null = null;

  const setState = (next: CaptureState): void => {
    state = next;
    for (const listener of listeners) {
      listener(state);
    }
  };

  const schedule = (ms: number, callback: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, ms);
    timers.add(timer);
  };

  const clearTimers = (): void => {
    for (const timer of timers) {
      clearTimeout(timer);
    }
    timers.clear();
  };

  const toIdle = (): void => {
    startedAt = null;
    clearTimers();
    setState({ phase: "idle" });
  };

  const start = (): void => {
    if (state.phase !== "idle") return;
    setState({ phase: "arming", reason: "warming stream" });
    schedule(0, () => {
      startedAt = Date.now();
      setState({ phase: "listening", startedAtMs: startedAt });
      // Stuck-key watchdog: if the keyup is eaten (sleep, alt-tab, crash),
      // force-stop instead of recording forever.
      schedule(options.maxCaptureMs, () => {
        if (state.phase === "listening") {
          stop();
        }
      });
    });
  };

  const stop = (): void => {
    if (state.phase !== "listening" || startedAt === null) return;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < options.minCaptureMs) {
      // Accidental tap. Nothing happened; nothing is reported.
      toIdle();
      return;
    }
    setState({
      phase: "transcribing",
      engineId: MOCK_ENGINE_ID,
      startedAtMs: startedAt
    });
    schedule(options.simulatedInferenceMs, () => {
      setState({ phase: "delivering", text: SIMULATED_TRANSCRIPT, inserted: false });
      schedule(options.deliverHoldMs, () => {
        toIdle();
      });
    });
  };

  const cancel = (): void => {
    if (state.phase !== "listening" && state.phase !== "arming") return;
    toIdle();
  };

  const fail = (message: string, text: string | null = null): void => {
    if (state.phase === "idle" || state.phase === "delivering") return;
    startedAt = null;
    clearTimers();
    setState({ phase: "error", message, text });
    schedule(options.errorHoldMs, () => {
      toIdle();
    });
  };

  const subscribe = (listener: (state: CaptureState) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return {
    get state(): CaptureState {
      return state;
    },
    start,
    stop,
    cancel,
    fail,
    subscribe
  };
};
