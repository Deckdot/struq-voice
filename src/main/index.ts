/**
 * Main process entry: lifecycle, single instance, boot order.
 * Phase 3 wires the engine router, OpenRouter secrets, settings and the
 * history database into the capture loop.
 */

import { join } from "node:path";
import { app, BrowserWindow, clipboard, Menu, nativeTheme, Notification } from "electron";
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
import { slicePcm, trimSilence } from "./audio/wav";
import type { TranscriptionEngine } from "./engines/types";
import { createHotkeys } from "./hotkeys";
import { registerIpcHandlers } from "./ipc";
import { createModelsService } from "./models";
import electronUpdater from "electron-updater";
import { createUpdater, type AutoUpdaterLike } from "./updater";
import type { AppReadiness, CapturePartialTranscriptEvent } from "../shared/ipc";
import {
  appReadinessChangedChannel,
  capturePartialTranscriptChannel,
  updatesChangedChannel
} from "../shared/ipc";
import { fail } from "../shared/result";

// electron-updater ships CommonJS, so the named exports hang off the default.
const { autoUpdater } = electronUpdater as unknown as { autoUpdater: AutoUpdaterLike };
import { cleanupTranscript } from "./post/text-cleanup";
import { insertTextIntoActiveApp } from "./platform/win32/paste";
import { createRecorderBridge } from "./audio/recorder-bridge";
import { createCaptureSoundPlayer } from "./audio/capture-sounds";
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
import { createPartialTranscriber } from "./session/partial-transcriber";
import { createSecretsStore } from "./store/secrets";
import { createSettingsStore } from "./store/settings-store";
import { installTestHook } from "./test-hook";
import { createTray } from "./tray";
import { createMainWindow } from "./windows/main-window";
import { createOverlayWindowController } from "./windows/overlay-window";
import { createRecorderWindow } from "./windows/recorder-window";
import { applyThemeSource } from "./theme";
import {
  createAutostart,
  isAutostartLaunch
} from "./platform/win32/autostart";
import { MOCK_ENGINE, MOCK_ENGINE_ID } from "../shared/engines";
import { ONBOARDING_VERSION } from "../shared/settings";
import type { HardwareProfile } from "../shared/hardware";
import { detectHardware } from "./hardware/detect";

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

// Keep Windows notifications and shell grouping attached to the same identity
// that electron-builder registers for the installed application.
if (process.platform === "win32") {
  app.setAppUserModelId("com.struq.voice");
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

/**
 * Tell the user an update is waiting, from outside the app.
 *
 * The main window is usually closed: Struq Voice lives in the tray, and a
 * dialog in a window nobody has open is a prompt that never arrives. A toast
 * reaches them either way, and clicking it opens the window onto the dialog
 * that actually installs. The toast itself installs nothing, so a stray click
 * on a notification can never restart the app.
 */
const notifyUpdateReady = (version: string): void => {
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title: "Struq Voice update ready",
      body: `Version ${version} is verified and ready to install.`
    });
    notification.on("click", () => {
      showMainWindow();
    });
    notification.show();
  } catch {
    // Notifications can fail on locked-down desktops. Settings still shows it.
  }
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
    applyThemeSource(nativeTheme, settingsStore.get().theme);
    settingsStore.subscribe((latest) => {
      applyThemeSource(nativeTheme, latest.theme);
    });
    const secrets = createSecretsStore();
    const history = openDatabase(app.getPath("userData"));
    const runtimeRoot = join(app.getPath("userData"), "runtimes");
    const models = createModelsService(
      join(app.getPath("userData"), "models"),
      runtimeRoot
    );
    const autostart = createAutostart();

    // Fetch the whisper.cpp runtime in the background on a fresh install, so
    // selecting the engine works without a manual trip to Models. Skipped
    // under e2e: the suite must not reach the network.
    if (!e2e) {
      models.ensureWhisperRuntime();
    }

    // The e2e suite drives the app directly and must never meet the
    // onboarding takeover, which would sit in front of every spec.
    if (e2e && !settingsStore.get().onboarding.completed) {
      settingsStore.update({
        onboarding: { completed: true, completedVersion: ONBOARDING_VERSION, hardware: null }
      });
    }

    // Keep the login-item flag in sync with the setting. Applied at boot so
    // an external change or a fresh install settles, then on every change.
    autostart.setEnabled(settingsStore.get().autostart);
    settingsStore.subscribe((settings) => {
      autostart.setEnabled(settings.autostart);
    });

    // Readiness the windows can poll or subscribe to: is the microphone live
    // and are the hotkeys armed. Broadcast on every change to either piece.
    let streamLive = false;
    let streamReason: string | undefined;
    let hotkeysStarted = false;
    let currentReadiness: AppReadiness = {
      microphone: { live: false },
      hotkeysActive: false
    };
    const broadcastReadiness = (): void => {
      const next: AppReadiness = {
        microphone:
          streamReason === undefined
            ? { live: streamLive }
            : { live: streamLive, reason: streamReason },
        hotkeysActive: hotkeysStarted
      };
      currentReadiness = next;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(appReadinessChangedChannel, next);
        }
      }
    };

    // The update channel. Nothing installs without passing the signature gate
    // in updater.ts, and nothing restarts without a click. Skipped under e2e so
    // the suite never reaches the network.
    //
    // isBusy is read through a late binding because the capture session is
    // built further down, and the updater has to exist before the IPC handlers
    // that reference it. It is only ever called on a click, long after boot.
    let captureBusy = (): boolean => false;
    const updater = e2e
      ? null
      : createUpdater({
          autoUpdater,
          isPackaged: app.isPackaged,
          isBusy: () => captureBusy(),
          onReady: (version) => {
            notifyUpdateReady(version);
          }
        });

    // Hardware detection feeds the onboarding recommendation. It runs once,
    // in the background, and never blocks boot: until it resolves the
    // recommendation falls back to the balanced tier.
    let hardware: HardwareProfile | null = null;
    void detectHardware({ runtimeRoot }).then((profile) => {
      hardware = profile;
    });

    // The overlay controller is built further down, so the move handler binds
    // late. It is only ever called from a drag, long after boot.
    registerIpcHandlers(
      history,
      models,
      settingsStore,
      secrets,
      updater,
      { getHardware: () => hardware },
      {
        moveTo: (x, y) => {
          overlay?.moveTo(x, y);
        }
      },
      { getReadiness: () => currentReadiness }
    );

    updater?.subscribe((state) => {
      // The window is created on demand and can be closed while a download is
      // in flight, so send only to a live one.
      if (mainWindow !== null && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(updatesChangedChannel, state);
      }
    });

    // One check at boot, best effort. An unreachable feed is not something to
    // interrupt anyone about; a refused signature surfaces in Settings.
    if (updater !== null && app.isPackaged) {
      void updater.check();
    }

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
    const whisperCppEngine = createWhisperCppEngine({
      runtimeRoot,
      modelsRoot,
      getModelId: () => settingsStore.get().whisperModelId
    });
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

    const sounds = createCaptureSoundPlayer({
      isEnabled: () => settingsStore.get().captureSounds,
      getVolume: () => settingsStore.get().captureSoundVolume
    });
    if (!e2e) {
      void sounds.warmup();
    }

    const session = createCaptureSession({
      ...DEFAULT_CAPTURE_OPTIONS,
      source,
      onAudio: (audio) => {
        lastCaptureAudio = audio;
      },
      onListeningEnd: () => {
        sounds.play("close");
      },
      transcribingEngineId: primaryEngineId,
      transcribe: async (audio) => {
        // Trim leading and trailing silence before inference: shorter audio
        // is faster, and the engines want the speech, not the room noise.
        // The whole-capture duration is still reported for history.
        const trimmed = trimSilence(audio.pcm, 16000);
        const pcm = slicePcm(audio.pcm, trimmed.start, trimmed.end);
        const trimmedDurationMs = Math.round(
          (pcm.length / 16000) * 1000
        );
        const outcome = await router.transcribe(
          {
            pcm,
            durationMs: Math.max(trimmedDurationMs, 1),
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

    overlay = createOverlayWindowController({
      e2e,
      initialPosition: settingsStore.get().overlayPosition,
      onPositionChange: (position) => {
        settingsStore.update({ overlayPosition: position });
      },
      isLiveTranscriptionEnabled: () => settingsStore.get().liveTranscription
    });

    /**
     * The live transcript. Off unless the user asked for it, and deliberately
     * routed to the primary engine directly rather than through the router: a
     * partial must never cascade to a cloud engine, which would send audio off
     * the machine and bill for text that is only ever shown, never delivered.
     */
    const partials = createPartialTranscriber({
      intervalMs: settingsStore.get().liveTranscriptionIntervalMs,
      snapshotTimeoutMs: 1500,
      minAudioMs: 600,
      snapshot: (timeoutMs) => bridge.requestSnapshot(timeoutMs),
      transcribe: async (audio, signal) => {
        const engine = engines.get(primaryEngineId);
        if (engine === undefined) {
          return fail({ code: "APP_NOT_READY", message: "Engine unavailable." });
        }
        if (engine.kind === "cloud") {
          return fail({
            code: "APP_NOT_READY",
            message: "Live transcript is local-only."
          });
        }
        const trimmed = trimSilence(audio.pcm, 16000);
        const pcm = slicePcm(audio.pcm, trimmed.start, trimmed.end);
        if (pcm.length === 0) {
          return fail({ code: "APP_NOT_READY", message: "Nothing to decode yet." });
        }
        return engine.transcribe({
          pcm,
          durationMs: Math.max(Math.round((pcm.length / 16000) * 1000), 1),
          signal
        });
      },
      onPartial: (partial) => {
        const payload: CapturePartialTranscriptEvent = partial;
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) {
            window.webContents.send(capturePartialTranscriptChannel, payload);
          }
        }
      }
    });

    /**
     * The capture sounds. Open fires when recording actually starts, not when
     * the key goes down, so it confirms that the microphone is live rather
     * than merely that the key registered. Close fires when listening ends,
     * on every route out: a normal stop, Escape, or a failure. A capture that
     * opened with a sound and ended in silence reads as one still running.
     */
    let wasListening = false;

    session.subscribe((state) => {
      const listening = state.phase === "listening";
      if (listening && !wasListening) {
        sounds.play("open");
      }
      wasListening = listening;

      if (listening) {
        if (settingsStore.get().liveTranscription && !partials.isRunning()) {
          partials.start();
        }
        return;
      }
      // Anything other than listening ends the live transcript, including the
      // transcribing phase: the final pass owns the engine from here.
      if (partials.isRunning()) {
        partials.stop();
      }
    });

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

    // Apply the configured hotkeys and re-register at runtime when the user
    // changes them in Settings. The PTT hook chord is applied immediately;
    // the toggle accelerator re-registers via globalShortcut.
    hotkeys.setHotkeys(
      settingsStore.get().pttAccelerator,
      settingsStore.get().toggleAccelerator
    );
    settingsStore.subscribe((latest) => {
      hotkeys?.setHotkeys(latest.pttAccelerator, latest.toggleAccelerator);
    });

    // An install clicked mid-capture waits for this. "idle" and "error" are
    // both terminal: an errored capture has nothing left to lose by restarting.
    captureBusy = () => session.state.phase !== "idle" && session.state.phase !== "error";

    session.subscribe((state) => {
      tray.setState(state);
      overlay?.update(state);
      if (state.phase === "idle" || state.phase === "error") {
        updater?.notifyIdle();
      }
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
    const maybeStartHotkeys = (): void => {
      if (hotkeysStarted || e2e) return;
      hotkeysStarted = true;
      hotkeys?.init();
      broadcastReadiness();
    };
    bridge.onStreamState((streamState) => {
      streamLive = streamState.live;
      streamReason = streamState.reason;
      broadcastReadiness();
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

    // Start hidden to the tray when launched at login; otherwise show the
    // main window. A tray-resident app popping a window over the desktop on
    // every boot is exactly the kind of interruption the product is against.
    const startedAtLogin =
      !e2e &&
      !hookTest &&
      isAutostartLaunch() &&
      process.env["STRUQ_VOICE_START_HIDDEN"] !== "0";
    if (startedAtLogin) {
      mainWindow = null;
    } else {
      mainWindow = createMainWindow();
      mainWindow.on("close", (event) => {
        if (!isQuitting) {
          // Close hides, it does not quit. Quit from the tray or Ctrl+Q.
          event.preventDefault();
          mainWindow?.hide();
          tray.notifyFirstHide();
        }
      });
    }

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
