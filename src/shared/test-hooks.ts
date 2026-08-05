/**
 * The E2E test harness surface. Installed on globalThis in the main process
 * only when STRUQ_VOICE_E2E=1, so tests can drive the capture session and
 * inspect windows and tray without touching real input devices.
 *
 * Types only: no side effects, no Electron imports.
 */

import type { CaptureState } from "./capture";

export interface TestHarnessApi {
  readonly drive: {
    start: () => void;
    stop: () => void;
    cancel: () => void;
    fail: (message: string) => void;
  };
  readonly getState: () => CaptureState;
  readonly tray: {
    getMenuItemIds: () => readonly string[];
    getTooltip: () => string | null;
  };
  readonly recorder: {
    isVisible: () => boolean;
  };
  readonly overlay: {
    exists: () => boolean;
    isVisible: () => boolean;
    isFocusable: () => boolean;
    isSkipTaskbar: () => boolean;
    isAlwaysOnTop: () => boolean;
  };
}

export interface TestHarnessGlobal {
  __struqVoiceTest?: TestHarnessApi;
}
