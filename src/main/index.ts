/**
 * Main process entry: lifecycle, single instance, boot order.
 * Phase 3 wires the engine router, OpenRouter secrets, settings and the
 * history database into the capture loop.
 */

import { join } from "node:path";
import { app, BrowserWindow, clipboard, Menu } from "electron";
import { openDatabase } from "./db/client";
import { createEngineRouter } from "./engines/router";
import { createMockEngine } from "./engines/mock";
import {
  createParakeetEngine,
  PARAKEET_DEFAULT_MODEL_ID,
  PARAKEET_ENGINE_ID
} from "./engines/parakeet";
import { createOpenRouterEngine, OPENROUTER_ENGINE_ID } from "./engines/openrouter";
import { createWhisperCppEngine } from "./engines/whisper-cpp";
import type { TranscriptionEngine } from "./engines/types";
import { createHotkeys } from "./hotkeys";
import { registerIpcHandlers } from "./ipc";
import { createModelsService } from "./models";
import { cleanupTranscript } from "./post/text-cleanup";
import { insertTextIntoActiveApp } from "./platform/win32/paste";
import { createRecorderBridge } from "./audio/recorder-bridge";
import {
  createRecorderAudioSource,
  createSimulatedAudioSource,
  type CaptureAudio,
} from "./session/audio-source";
import {
  DEFAULT_CAPTURE_OPTIONS,
  createCaptureSession,
  type TranscriptMeta,
} from "./session/capture-session";
import { createSecretsStore } from "./store/secrets";
import { createSettingsStore } from "./store/settings-store";
import { installTestHook } from "./test-hook";
import { createTray } from "./tray";
import { createMainWindow } from "./windows/main-window";
import { createOverlayWindowController } from "./windows/overlay-window";
import { createRecorderWindow } from "./windows/recorder-window";
import { MOCK_ENGINE, MOCK_ENGINE_ID } from "../shared/engines";

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

    const settingsStore = createSettingsStore(join(app.getPath("userData"), "settings.json"));
    const secrets = createSecretsStore();
    const history = openDatabase(app.getPath("userData"));
    const models = createModelsService(join(app.getPath("userData"), "models"));

    registerIpcHandlers(history, models, settingsStore);

    const recorderWindow = createRecorderWindow({ e2e });
    const bridge = createRecorderBridge();
    const source = e2e
      ? createSimulatedAudioSource(app.getAppPath())
      : createRecorderAudioSource(recorderWindow, bridge);

    // Engines: cloud first per the plan, mock as the bootstrap default.
    const modelsRoot = join(app.getPath("userData"), "models");
    const mockEngine = createMockEngine();
    const parakeetEngine = createParakeetEngine({
      modelsRoot,
      modelId: PARAKEET_DEFAULT_MODEL_ID
    });
    const openrouterEngine = createOpenRouterEngine({
      getApiKey: () => secrets.readOpenRouterKey()
    });
    const runtimeRoot = join(app.getPath("userData"), "runtimes");
    const whisperCppEngine = createWhisperCppEngine({ runtimeRoot });
    const engines = new Map<string, TranscriptionEngine>([
      [mockEngine.id, mockEngine],
      [parakeetEngine.id, parakeetEngine],
      [whisperCppEngine.id, whisperCppEngine],
      [openrouterEngine.id, openrouterEngine]
    ]);
    const router = createEngineRouter({
      getEngine: (id) => engines.get(id),
      cloudFallbackOptIn: () => settingsStore.get().engine.fallback === "openrouter",
    });

    const envEngineOverride = process.env["STRUQ_VOICE_ENGINE"];
    const settings = settingsStore.get();
    // Bootstrap promotion: Parakeet becomes the primary once its model is
    // downloaded; otherwise OpenRouter once a key exists; otherwise the mock
    // stays until the user chooses in Settings. Skipped in test modes: the
    // readiness check loads the sherpa native module, which is exactly the
    // native interference the hook spec isolates against.
    if (!e2e && !hookTest) {
      void parakeetEngine.readiness().then((readiness) => {
        const latest = settingsStore.get();
        if (readiness.ready && latest.engine.primary === MOCK_ENGINE_ID) {
          settingsStore.update({
            engine: { ...latest.engine, primary: PARAKEET_ENGINE_ID },
          });
        }
      });
    }
    void secrets.readOpenRouterKey().then((key) => {
      const latest = settingsStore.get();
      if (key !== null && key.length > 0 && latest.engine.primary === MOCK_ENGINE_ID) {
        settingsStore.update({
          engine: { ...latest.engine, primary: OPENROUTER_ENGINE_ID },
        });
      }
    });
    const primaryEngineId = envEngineOverride ?? settings.engine.primary;

    const session = createCaptureSession({
      ...DEFAULT_CAPTURE_OPTIONS,
      source,
      onAudio: (audio) => {
        lastCaptureAudio = audio;
      },
      transcribingEngineId: primaryEngineId,
      transcribe: async (audio) => {
        const outcome = await router.transcribe(
          {
            pcm: audio.pcm,
            durationMs: audio.durationMs,
          },
          primaryEngineId,
          settingsStore.get().engine.fallback,
        );
        if (!outcome.ok) {
          throw new Error(outcome.error.message);
        }
        const { result } = outcome.value;
        const meta: TranscriptMeta = {
          engineId: result.engineId,
          modelId: result.modelId,
          language: result.language,
          inferenceMs: result.inferenceMs,
          costUsd: result.costUsd,
          durationMs: audio.durationMs,
        };
        // Post-processing: dictionary, fillers, punctuation. Reads settings
        // at delivery time; the user may have changed them mid-capture.
        const current = settingsStore.get();
        const text = cleanupTranscript(result.text, {
          dictionary: current.post.dictionary,
          removeFillers: current.post.removeFillers,
          addTrailingPunctuation: current.post.addTrailingPunctuation,
        });
        return { text, meta };
      },
      onTranscript: (text, meta) => {
        if (history !== null) {
          history.insert({
            text,
            engineId: meta.engineId,
            modelId: meta.modelId,
            durationMs: meta.durationMs,
            inferenceMs: meta.inferenceMs,
            costUsd: meta.costUsd,
            language: meta.language,
          });
          refreshRecentTranscripts();
        }
      },
      deliver: async (text) => {
        // Tests must never synthesize keystrokes into the real desktop.
        // A stray Ctrl+V landing in the user's focused window is hostile.
        if (e2e || hookTest) return { inserted: false };
        const outcome = await insertTextIntoActiveApp(text, {
          // Read at delivery time: the user may have changed the setting
          // since this capture started.
          restoreClipboard: settingsStore.get().restoreClipboard,
          restoreClipboardDelayMs: settingsStore.get().restoreClipboardDelayMs,
        });
        return outcome.ok ? outcome.value : { inserted: false };
      },
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
      onQuit: () => {
        app.quit();
      },
      onCopyTranscript: (text) => {
        clipboard.writeText(text);
      },
      engineDisplayName: () => engines.get(primaryEngineId)?.displayName ?? MOCK_ENGINE.displayName,
    });

    const refreshRecentTranscripts = (): void => {
      if (history === null) return;
      tray.setRecentTranscripts(
        history.listRecent(5).map((item) => ({ id: item.id, text: item.text })),
      );
    };
    refreshRecentTranscripts();

    hotkeys = createHotkeys({
      e2e,
      onPttStart: () => {
        session.start();
      },
      onPttStop: () => {
        session.stop();
      },
      onToggle: toggleCapture,
    });

    session.subscribe((state) => {
      tray.setState(state);
      overlay?.update(state);
      if (state.phase === "listening") {
        // Escape cancels a capture. Registered only for the duration of the
        // capture, since the overlay cannot receive key events.
        hotkeys?.registerEscape(() => {
          session.cancel();
        });
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
        session.fail("Microphone lost. Check the device connection and try again.");
      }
    });
    setTimeout(maybeStartHotkeys, 5000);

    // Parakeet warmup: loading the int8 encoder takes 1-3 seconds, and it
    // must never land in the user's first capture. Background at app start,
    // before the first hotkey press. Skipped in test modes: the sherpa
    // native load is exactly the kind of native interference the hook spec
    // isolates against. Fails silently; the engine reports readiness itself.
    if (!e2e && !hookTest) {
      void parakeetEngine.warmup();
    }

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
        history,
        getLastCaptureAudio: () => lastCaptureAudio,
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
