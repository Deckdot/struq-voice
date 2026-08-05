/**
 * Main process entry: lifecycle, single instance, boot order.
 * Phase 2 wires the recorder audio source, live levels relay, the stream
 * watchdog, and starts the keyboard hook only after the stream is live.
 */

import { app, BrowserWindow, Menu } from "electron";
import { createRecorderBridge } from "./audio/recorder-bridge";
import { createHotkeys } from "./hotkeys";
import { registerIpcHandlers } from "./ipc";
import {
  createRecorderAudioSource,
  createSimulatedAudioSource,
  type CaptureAudio
} from "./session/audio-source";
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
// The keyboard-hook verification spec: like production, but it installs the
// test hook so the synthesized capture cycles are observable.
const hookTest = process.env["STRUQ_VOICE_HOOK_TEST"] === "1";

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

// The most recent capture, kept for verification until Phase 3 persists
// history. Never written to disk in the hot path.
let lastCaptureAudio: CaptureAudio | null = null;

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

    const recorderWindow = createRecorderWindow({ e2e });
    const bridge = createRecorderBridge();
    const source = e2e
      ? createSimulatedAudioSource()
      : createRecorderAudioSource(recorderWindow, bridge);

    const session = createCaptureSession({
      ...DEFAULT_CAPTURE_OPTIONS,
      source,
      onAudio: (audio) => {
        lastCaptureAudio = audio;
      }
    });

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

    // uIOhook starts only after the recorder window has its stream: this is
    // the structural fix for the uiohook-napi issue where getUserMedia while
    // a window is focused kills the global hook. Fall back after 5s if the
    // stream never comes up (the app must never fail to boot over this).
    let hotkeysStarted = false;
    const maybeStartHotkeys = (): void => {
      if (hotkeysStarted || e2e) return;
      hotkeysStarted = true;
      hotkeys?.init();
    };
    bridge.onStreamState((streamState) => {
      if (streamState.live) {
        maybeStartHotkeys();
      }
      // A dead microphone must never silently produce empty transcripts.
      if (!streamState.live && session.state.phase === "listening") {
        session.fail(
          "Microphone lost. Check the device connection and try again."
        );
      }
    });
    setTimeout(maybeStartHotkeys, 5000);

    mainWindow = createMainWindow();
    mainWindow.on("close", (event) => {
      if (!isQuitting) {
        // Close hides, it does not quit. Quit from the tray or Ctrl+Q.
        event.preventDefault();
        mainWindow?.hide();
        tray.notifyFirstHide();
      }
    });

    if (e2e || hookTest) {
      installTestHook({
        session,
        tray,
        overlay,
        recorderWindow,
        bridge,
        getLastCaptureAudio: () => lastCaptureAudio
      });
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
