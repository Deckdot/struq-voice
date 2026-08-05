/**
 * The E2E test harness surface. Installed on globalThis in the main process
 * only when STRUQ_VOICE_E2E=1, so tests can drive the capture session and
 * inspect windows and tray without touching real input devices.
 *
 * Types only: no side effects, no Electron imports.
 */

import type { CaptureState } from "./capture";
import type { TranscriptRecord } from "./ipc";

export interface TestHarnessApi {
  readonly drive: {
    start: () => void;
    stop: () => void;
    cancel: () => void;
    fail: (message: string) => void;
  };
  readonly getState: () => CaptureState;
  readonly history: {
    getRecent: () => readonly TranscriptRecord[];
  };
  readonly tray: {
    getMenuItemIds: () => readonly string[];
    getTooltip: () => string | null;
  };
  readonly recorder: {
    isVisible: () => boolean;
    isLive: () => boolean;
  };
  readonly overlay: {
    exists: () => boolean;
    isVisible: () => boolean;
    isFocusable: () => boolean;
    isSkipTaskbar: () => boolean;
    isAlwaysOnTop: () => boolean;
  };
  /** Synthesised keyboard hold, for the hook-verification spec. */
  readonly keyboard: {
    pressAndHold: () => void;
    releaseHold: () => void;
  };
  /** The most recent capture as a WAV, base64, for audio verification. */
  getLastCaptureWav: () => { base64: string; durationMs: number } | null;
}

export interface TestHarnessGlobal {
  __struqVoiceTest?: TestHarnessApi;
}
