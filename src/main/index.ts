/**
 * Main process entry: lifecycle, single instance, boot order.
 * Phase 1 wires: main window (close hides), recorder window, overlay
 * controller, capture session, hotkeys, tray, and the E2E test hook.
 */

import { app, BrowserWindow, Menu } from "electron";
import { registerIpcHandlers } from "./ipc";
import { createHotkeys } from "./hotkeys";
import {
  DEFAULT_CAPTURE_OPTIONS,
  createCaptureSession
} from "./session/capture-session";
import { installTestHook } from "./test-hook";
import { createTray } from "./tray";
import { createMainWindow } from "./windows/main-window";
import { createOverlayWindowController } from "./windows/overlay-window";
import { createRecorderWindow } from "./windows/recorder-window";
import { MOCK_ENGINE } from "../shared/engines";

const e2e = process.env["STRUQ_VOICE_E2E"] === "1";

// Test isolation: e2e runs always point userData at a fresh temp dir so the
// real profile is never touched. Must happen before app is ready.
const userDataOverride = process.env["STRUQ_VOICE_USERDATA"];
if (userDataOverride !== undefined) {
  app.setPath("userData", userDataOverride);
}

let mainWindow: BrowserWindow | null = null;
let overlay: ReturnType<typeof createOverlayWindowController> | null = null;
let hotkeys: ReturnType<typeof createHotkeys> | null = null;
let isQuitting = false;

app.on("before-quit", () => {
  isQuitting = true;
});

const showMainWindow = (): void => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
};

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  void app.whenReady().then(() => {
    // The app draws its own chrome, so suppress Electron's default menu.
    Menu.setApplicationMenu(null);

    registerIpcHandlers();

    const recorderWindow = createRecorderWindow();

    const session = createCaptureSession(DEFAULT_CAPTURE_OPTIONS);

    overlay = createOverlayWindowController({ e2e });

    const toggleCapture = (): void => {
      const phase = session.state.phase;
      if (phase === "listening" || phase === "arming") {
        session.stop();
      } else {
        session.start();
      }
    };

    const tray = createTray({
      onToggleCapture: toggleCapture,
      onOpenMainWindow: showMainWindow,
      onSetHotkeysPaused: (paused) => hotkeys?.setPaused(paused),
      onQuit: () => { app.quit(); },
      engineDisplayName: () => MOCK_ENGINE.displayName
    });

    hotkeys = createHotkeys({
      e2e,
      onPttStart: () => { session.start(); },
      onPttStop: () => { session.stop(); },
      onToggle: toggleCapture
    });

    session.subscribe((state) => {
      tray.setState(state);
      overlay?.update(state);
      if (state.phase === "listening") {
        // Escape cancels a capture. Registered only for the duration of the
        // capture, since the overlay cannot receive key events.
        hotkeys?.registerEscape(() => { session.cancel(); });
      } else {
        hotkeys?.unregisterEscape();
      }
    });

    hotkeys.init();

    mainWindow = createMainWindow();
    mainWindow.on("close", (event) => {
      if (!isQuitting) {
        // Close hides, it does not quit. Quit from the tray or Ctrl+Q.
        event.preventDefault();
        mainWindow?.hide();
        tray.notifyFirstHide();
      }
    });

    if (e2e) {
      installTestHook({ session, tray, overlay, recorderWindow });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createMainWindow();
      }
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("will-quit", () => {
    overlay?.dispose();
    hotkeys?.dispose();
  });
}
