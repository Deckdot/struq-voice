/**
 * E2E test hook installation. Only active when STRUQ_VOICE_E2E=1: tests drive
 * the capture session and inspect windows and tray without touching real input
 * devices. Never installed in production.
 */

import type { BrowserWindow } from "electron";
import type { TestHarnessApi, TestHarnessGlobal } from "../shared/test-hooks";
import type { CaptureSession } from "./session/capture-session";
import type { TrayController } from "./tray";
import type { OverlayWindowController } from "./windows/overlay-window";

export interface TestHookInput {
  readonly session: CaptureSession;
  readonly tray: TrayController;
  readonly overlay: OverlayWindowController;
  readonly recorderWindow: BrowserWindow | null;
}

export const installTestHook = (input: TestHookInput): void => {
  const overlayState = (): {
    exists: boolean;
    isVisible: boolean;
    isFocusable: boolean;
    isSkipTaskbar: boolean;
    isAlwaysOnTop: boolean;
  } => {
    const window = input.overlay.getWindow();
    if (window === null || window.isDestroyed()) {
      return {
        exists: false,
        isVisible: false,
        isFocusable: false,
        isSkipTaskbar: false,
        isAlwaysOnTop: false
      };
    }
    return {
      exists: true,
      isVisible: window.isVisible(),
      isFocusable: window.isFocusable(),
      // Electron has no getter for skipTaskbar; the overlay is created with
      // skipTaskbar: true in the constructor and nothing ever changes it.
      isSkipTaskbar: true,
      isAlwaysOnTop: window.isAlwaysOnTop()
    };
  };

  const api: TestHarnessApi = {
    drive: {
      start: () => { input.session.start(); },
      stop: () => { input.session.stop(); },
      cancel: () => { input.session.cancel(); },
      fail: (message: string) => { input.session.fail(message); }
    },
    getState: () => input.session.state,
    tray: {
      getMenuItemIds: () => input.tray.getMenuItemIds(),
      getTooltip: () => input.tray.getTooltip()
    },
    recorder: {
      isVisible: () => input.recorderWindow?.isVisible() ?? false
    },
    overlay: {
      exists: () => overlayState().exists,
      isVisible: () => overlayState().isVisible,
      isFocusable: () => overlayState().isFocusable,
      isSkipTaskbar: () => overlayState().isSkipTaskbar,
      isAlwaysOnTop: () => overlayState().isAlwaysOnTop
    }
  };

  const globalWithHook = globalThis as unknown as TestHarnessGlobal;
  globalWithHook.__struqVoiceTest = api;
};
