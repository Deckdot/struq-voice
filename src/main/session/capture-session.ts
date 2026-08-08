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
import type { PasteOutcome } from "../platform/win32/paste";
import type { CaptureAudio, CaptureAudioSource } from "./audio-source";

export const SIMULATED_TRANSCRIPT =
  "This is a simulated transcript. Hold the hotkey anywhere in Windows and speak.";

export interface TranscriptMeta {
  readonly engineId: string;
  readonly modelId: string;
  readonly language: string | null;
  readonly inferenceMs: number;
  readonly costUsd: number | null;
  readonly durationMs: number;
}

export interface CaptureSessionOptions {
  /** Captures shorter than this (ms) are discarded silently. */
  readonly minCaptureMs: number;
  /** Force-stop a capture that ran this long (ms): stuck key, sleep, alt-tab. */
  readonly maxCaptureMs: number;
  /** Read live settings at the start of each capture when provided. */
  readonly getMinCaptureMs?: () => number;
  readonly getMaxCaptureMs?: () => number;
  /** Simulated inference time between stop and delivering (ms). */
  readonly simulatedInferenceMs: number;
  /** How long delivering stays on screen before returning to idle (ms). */
  readonly deliverHoldMs: number;
  /** How long error stays on screen before returning to idle (ms). */
  readonly errorHoldMs: number;
  /** The audio source. Omitted in Phase 1, real or simulated from Phase 2. */
  readonly source?: CaptureAudioSource;
  /** Called with the captured audio before delivering. */
  readonly onAudio?: (audio: CaptureAudio) => void;
  /** Transcribe the captured audio; replaces the simulated transcript. */
  readonly transcribe?: (audio: CaptureAudio) => Promise<{ text: string; meta: TranscriptMeta }>;
  /** Engine shown in the transcribing state while inference runs. */
  readonly transcribingEngineId?: string;
  /** Called once the transcript exists, before delivering. */
  readonly onTranscript?: (text: string, meta: TranscriptMeta) => void;
  /** Called synchronously when a real listening capture ends. */
  readonly onListeningEnd?: () => void;
  /** Deliver the transcript into the focused window. Omitted in tests. */
  readonly deliver?: (text: string) => Promise<PasteOutcome>;
}

export const DEFAULT_CAPTURE_OPTIONS: CaptureSessionOptions = {
  minCaptureMs: 350,
  maxCaptureMs: 300_000,
  simulatedInferenceMs: 300,
  deliverHoldMs: 900,
  errorHoldMs: 4000,
};

export interface CaptureSession {
  readonly state: CaptureState;
  start: () => void;
  stop: () => void;
  cancel: () => void;
  fail: (message: string, text?: string | null) => void;
  subscribe: (listener: (state: CaptureState) => void) => () => void;
}

export const createCaptureSession = (options: CaptureSessionOptions): CaptureSession => {
  let state: CaptureState = INITIAL_CAPTURE_STATE;
  const listeners = new Set<(state: CaptureState) => void>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let startedAt: number | null = null;
  let activeMinCaptureMs = options.minCaptureMs;
  // Bumped on every capture. The paste result comes back asynchronously, and
  // comparing the text alone cannot tell a late result apart from a newer
  // capture that happens to have produced the same words.
  let generation = 0;

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

  const delay = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      schedule(ms, () => {
        resolve();
      });
    });

  const toIdle = (): void => {
    startedAt = null;
    clearTimers();
    setState({ phase: "idle" });
  };

  const start = (): void => {
    if (state.phase !== "idle") return;
    generation++;
    setState({ phase: "arming", reason: "warming stream" });
    schedule(0, () => {
      activeMinCaptureMs = options.getMinCaptureMs?.() ?? options.minCaptureMs;
      const maxCaptureMs = options.getMaxCaptureMs?.() ?? options.maxCaptureMs;
      startedAt = Date.now();
      setState({ phase: "listening", startedAtMs: startedAt });
      try {
        options.source?.beginCapture(maxCaptureMs);
      } catch (error) {
        fail("Microphone unavailable. Check the device and try again.");
        void error;
        return;
      }
      // Stuck-key watchdog: if the keyup is eaten (sleep, alt-tab, crash),
      // force-stop instead of recording forever.
      schedule(maxCaptureMs, () => {
        if (state.phase === "listening") {
          stop();
        }
      });
    });
  };

  const stop = (): void => {
    if (state.phase !== "listening" || startedAt === null) return;
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < activeMinCaptureMs) {
      // Accidental tap. Nothing happened; nothing is reported. The worklet is
      // still armed from beginCapture, so throw the buffer away explicitly.
      options.source?.discardCapture();
      toIdle();
      return;
    }
    options.onListeningEnd?.();
    void finishCapture(startedAt);
  };

  // A function so the type checker cannot narrow: the phase CAN change
  // while we await (listeners call cancel or fail), even though the
  // control flow in this function looks sequential.
  const currentPhase = (): CaptureState["phase"] => state.phase;

  const finishCapture = async (captureStartedAt: number): Promise<void> => {
    setState({
      phase: "transcribing",
      engineId: options.transcribingEngineId ?? MOCK_ENGINE_ID,
      startedAtMs: captureStartedAt,
    });

    let audio: CaptureAudio | null = null;
    if (options.source !== undefined) {
      try {
        audio = await options.source.endCapture();
      } catch (error) {
        fail("Microphone lost. Check the device connection and try again.", null);
        void error;
        return;
      }
    }

    // The capture may have been cancelled or failed while we waited.
    if (currentPhase() !== "transcribing") return;

    let text = SIMULATED_TRANSCRIPT;
    let meta: TranscriptMeta | null = null;

    if (audio !== null) {
      options.onAudio?.(audio);
      if (options.transcribe !== undefined) {
        try {
          const outcome = await options.transcribe(audio);
          text = outcome.text;
          meta = outcome.meta;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Transcription failed. Try again.";
          fail(message, null);
          void error;
          return;
        }
        if (currentPhase() !== "transcribing") return;
      } else {
        await delay(options.simulatedInferenceMs);
        if (currentPhase() !== "transcribing") return;
      }
    } else {
      await delay(options.simulatedInferenceMs);
      if (currentPhase() !== "transcribing") return;
    }

    if (meta !== null) {
      options.onTranscript?.(text, meta);
    }

    setState({ phase: "delivering", text, inserted: false });
    if (options.deliver !== undefined) {
      // Fire-and-forget: the paste must not delay the delivering hold or
      // the return to idle. keyTap completes in ~2ms; the state updates
      // when it settles, and only if we are still in the same delivering
      // state (a new capture may have replaced it meanwhile). The generation
      // is what makes that check exact: two captures can produce the same
      // text, and then the text alone cannot tell them apart.
      const deliveringGeneration = generation;
      const stillCurrent = (): boolean =>
        deliveringGeneration === generation &&
        state.phase === "delivering" &&
        state.text === text;
      void options
        .deliver(text)
        .then((outcome) => {
          if (stillCurrent()) {
            setState({ phase: "delivering", text, inserted: outcome.inserted });
          }
        })
        .catch(() => {
          if (stillCurrent()) {
            setState({ phase: "delivering", text, inserted: false });
          }
        });
    }
    schedule(options.deliverHoldMs, () => {
      toIdle();
    });
  };

  const cancel = (): void => {
    if (state.phase !== "listening" && state.phase !== "arming") return;
    if (state.phase === "listening") options.onListeningEnd?.();
    // The worklet stays armed after a cancel: release its buffer or it grows
    // for as long as the app sits idle.
    options.source?.discardCapture();
    toIdle();
  };

  const fail = (message: string, text: string | null = null): void => {
    if (state.phase === "idle" || state.phase === "delivering") return;
    if (state.phase === "listening") options.onListeningEnd?.();
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
    subscribe,
  };
};
