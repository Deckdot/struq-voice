/**
 * Main process entry: lifecycle, single instance, boot order.
 * Phase 3 wires the engine router, OpenRouter secrets, settings and the
 * history database into the capture loop.
 */

import { join } from "node:path";
import { availableParallelism } from "node:os";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeTheme,
  net,
  Notification
} from "electron";
import { openDatabase } from "./db/client";
import { createEngineRouter } from "./engines/router";
import { createMockEngine } from "./engines/mock";
import {
  createParakeetEngine,
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
import { createUpdater, PERIODIC_CHECK_INTERVAL_MS, type AutoUpdaterLike } from "./updater";
import type { AppReadiness, CapturePartialTranscriptEvent } from "../shared/ipc";
import {
  appReadinessChangedChannel,
  capturePartialTranscriptChannel,
  meetingStateChangedChannel,
  updatesChangedChannel
} from "../shared/ipc";
import { fail } from "../shared/result";
import { isMeetingActive } from "../shared/meeting";

// electron-updater ships CommonJS, so the named exports hang off the default.
const { autoUpdater } = electronUpdater as unknown as { autoUpdater: AutoUpdaterLike };

/**
 * Downloads through Chromium's network stack instead of Node's. undici
 * (globalThis.fetch) ignores the Windows system proxy and validates TLS
 * against Node's bundled Mozilla roots; corporate laptops sit behind an
 * egress proxy whose root CA the OS store trusts and Node does not. That is
 * why model downloads died on managed machines while the updater, which
 * drives Electron's net internally, worked. All model, runtime and manifest
 * fetches go through here so every path honors the system proxy and the OS
 * certificate store.
 */
const netFetch: typeof fetch = (input, init) =>
  net.fetch(input as string | Request, init);
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
import { createMeetingWindow } from "./windows/meeting-window";
import { installLoopbackHandler } from "./meeting/loopback";
import { createMeetingAssetService } from "./meeting/assets";
import { createArchiveWriter } from "./meeting/archive-writer";
import { createMeetingSession } from "./meeting/meeting-session";
import { createMeetingWorkerClient } from "./meeting/worker-client";
import { registerMeetingIpcHandlers } from "./meeting/ipc";
import { applyThemeSource } from "./theme";
import {
  createAutostart,
  isAutostartLaunch
} from "./platform/win32/autostart";
import { MOCK_ENGINE, MOCK_ENGINE_ID } from "../shared/engines";
import { ONBOARDING_VERSION } from "../shared/settings";
import type { HardwareProfile } from "../shared/hardware";
import { detectHardware } from "./hardware/detect";
import { getArchitectureSupportError } from "./platform/win32/architecture";

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
let meetingSession: ReturnType<typeof createMeetingSession> | null = null;
// Held at module scope so will-quit can release them: the sherpa session owns
// native memory and the database owns a WAL that wants checkpointing.
let database: ReturnType<typeof openDatabase> = null;
let primaryLocalEngine: TranscriptionEngine | null = null;
let updaterController: ReturnType<typeof createUpdater> | null = null;
let isQuitting = false;

app.on("before-quit", () => {
  isQuitting = true;
});

// The most recent capture, kept for verification until Phase 3 persists
// history. Never written to disk in the hot path.
let lastCaptureAudio: CaptureAudio | null = null;

import { isRtl, resolveLocale, type SupportedLocale } from "../shared/i18n";

const getResolvedLocale = (settings: { locale: string }): SupportedLocale => {
  const envLocale = process.env["STRUQ_VOICE_LOCALE"];
  if (envLocale !== undefined && envLocale.length > 0) {
    return envLocale as SupportedLocale;
  }
  if (settings.locale !== "system" && settings.locale.length > 0) {
    return settings.locale as SupportedLocale;
  }
  return resolveLocale(app.getPreferredSystemLanguages());
};

const getLocaleOptions = (settings: { locale: string }): { locale: string; dir: "ltr" | "rtl" } => {
  const loc = getResolvedLocale(settings);
  return { locale: loc, dir: isRtl(loc) ? "rtl" : "ltr" };
};

const showMainWindow = (currentSettings?: { locale: string }): void => {
  if (mainWindow === null || mainWindow.isDestroyed()) {
    const options = currentSettings !== undefined ? getLocaleOptions(currentSettings) : undefined;
    mainWindow = createMainWindow(options);
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
    const architectureError = getArchitectureSupportError(process.platform, process.arch);
    if (architectureError !== null) {
      dialog.showErrorBox(architectureError.title, architectureError.message);
      app.quit();
      return;
    }
    // The app draws its own chrome, so suppress Electron's default menu.
    Menu.setApplicationMenu(null);
    installLoopbackHandler();

    const settingsStore = createSettingsStore(join(app.getPath("userData"), "settings.json"));
    applyThemeSource(nativeTheme, settingsStore.get().theme);
    settingsStore.subscribe((latest) => {
      applyThemeSource(nativeTheme, latest.theme);
    });
    nativeTheme.on("updated", () => {
      applyThemeSource(nativeTheme, settingsStore.get().theme);
    });
    const secrets = createSecretsStore();
    const db = openDatabase(app.getPath("userData"));
    database = db;
    const history = db?.history ?? null;
    const meetingStore = db?.meetings ?? null;

    // A meeting row still marked recording is one the app did not survive.
    // Its segments are already on disk; mark the meeting so the list is
    // honest rather than showing it as live forever.
    meetingStore?.markInterruptedOnBoot();

    // Retention: delete meetings older than the cutoff, rows and recording
    // directories. One sweep at boot, delayed so it never competes with boot.
    const retentionDays = settingsStore.get().meeting.retentionDays;
    if (retentionDays > 0 && meetingStore !== null) {
      setTimeout(() => {
        const cutoffMs = Date.now() - retentionDays * 86_400_000;
        for (const expired of meetingStore.listExpired(cutoffMs)) {
          meetingStore.removeMeeting(expired.id);
          if (expired.audioPath !== null) {
            void import("node:fs/promises").then(({ rm }) => {
              void rm(join(expired.audioPath as string, ".."), { recursive: true, force: true });
            });
          }
        }
      }, 10_000);
    }
    const runtimeRoot = join(app.getPath("userData"), "runtimes");
    const models = createModelsService(
      join(app.getPath("userData"), "models"),
      runtimeRoot,
      { fetch: netFetch }
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
          deps: { fetch: netFetch },
          periodicCheckMs: PERIODIC_CHECK_INTERVAL_MS,
          onReady: (version) => {
            notifyUpdateReady(version);
          }
        });
    updaterController = updater;

    // Hardware detection feeds the onboarding recommendation. It runs once,
    // in the background, and never blocks boot: until it resolves the
    // recommendation falls back to the balanced tier.
    let hardware: HardwareProfile | null = null;
    void detectHardware({ runtimeRoot }).then((profile) => {
      hardware = profile;
    });

    const modelsRoot = join(app.getPath("userData"), "models");
    const meetingsRoot = join(app.getPath("userData"), "meetings");
    // Packaged builds ship the meeting models beside the app, so Meetings
    // works on a fresh install with nothing to download. In a dev checkout
    // they come from the repo's resources/ if vendored, and otherwise the
    // service falls back to fetching them into userData.
    const meetingAssets = createMeetingAssetService(
      join(app.getPath("userData"), "meeting-assets"),
      {
        fetch: netFetch,
        bundledRoot: app.isPackaged
          ? join(process.resourcesPath, "meeting-assets")
          : join(app.getAppPath(), "resources", "meeting-assets")
      }
    );
    const meetings = createMeetingSession({
      settings: () => settingsStore.get().meeting,
      speechLanguage: () => settingsStore.get().speechLanguage,
      store: meetingStore,
      worker: createMeetingWorkerClient(),
      window: {
        create: () => Promise.resolve(createMeetingWindow()),
        destroy: () => {
          // Runs during quit as well as on stop, and by then Electron may have
          // torn windows down already. Reading webContents off a destroyed
          // window throws "Object has been destroyed", which on the quit path
          // aborted the rest of shutdown and surfaced as a JavaScript error
          // dialog during an update install.
          for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed()) continue;
            if (window.webContents.getURL().includes("meeting/index.html")) {
              window.destroy();
            }
          }
        }
      },
      archive: createArchiveWriter(),
      assets: meetingAssets,
      paths: { modelsRoot, runtimeRoot, meetingsRoot },
      resolveModelId: (engine) =>
        engine === "parakeet"
          ? settingsStore.get().parakeetModelId
          : settingsStore.get().whisperModelId,
      cores: availableParallelism()
    });
    meetingSession = meetings;
    registerMeetingIpcHandlers(meetingStore, meetings, meetingAssets);

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

    // One check at boot, best effort, then a periodic re-check while the app
    // runs so a release shipped after boot still arrives. An unreachable feed
    // is not something to interrupt anyone about; a refused signature
    // surfaces in Settings.
    if (updater !== null && app.isPackaged) {
      void updater.check();
    }

    const recorderWindow = createRecorderWindow({ e2e });
    const bridge = createRecorderBridge();
    const source = e2e
      ? createSimulatedAudioSource(app.getAppPath())
      : createRecorderAudioSource(recorderWindow, bridge);

    const parakeetEngine = createParakeetEngine({
      modelsRoot,
      getModelId: () => settingsStore.get().parakeetModelId
    });
    primaryLocalEngine = parakeetEngine;
    const openrouterEngine = createOpenRouterEngine({
      getApiKey: () => secrets.readOpenRouterKey()
    });
    const whisperCppEngine = createWhisperCppEngine({
      runtimeRoot,
      modelsRoot,
      getModelId: () => settingsStore.get().whisperModelId
    });
    const engines = new Map<string, TranscriptionEngine>([
      [parakeetEngine.id, parakeetEngine],
      [whisperCppEngine.id, whisperCppEngine],
      [openrouterEngine.id, openrouterEngine]
    ]);
    // The mock exists for the e2e harness and nowhere else. Registering it
    // only under the test flags means a packaged build has no code path that
    // can reach it, so "practice mode" cannot be selected, fallen back to, or
    // stumbled into by a user who has not finished setting up.
    if (e2e || hookTest) {
      const mockEngine = createMockEngine();
      engines.set(mockEngine.id, mockEngine);
    }
    const router = createEngineRouter({
      getEngine: (id) => engines.get(id),
      cloudFallbackOptIn: () => settingsStore.get().engine.fallback === "openrouter",
    });

    const envEngineOverride = process.env["STRUQ_VOICE_ENGINE"];
    const settings = settingsStore.get();
    // Bootstrap promotion: a profile still pointing at the retired mock is
    // moved onto a real engine, preferring the local one once its model is on
    // disk and OpenRouter once a key exists. Skipped in test modes: the
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
      void secrets.readOpenRouterKey().then((key) => {
        const latest = settingsStore.get();
        if (key !== null && key.length > 0 && latest.engine.primary === MOCK_ENGINE_ID) {
          settingsStore.update({
            engine: { ...latest.engine, primary: OPENROUTER_ENGINE_ID },
          });
        }
      });
    }
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
      getMinCaptureMs: () => settingsStore.get().minCaptureMs,
      getMaxCaptureMs: () => settingsStore.get().maxCaptureMs,
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
          // "auto" is a request to detect, not a language. Prefer what the
          // engine actually reported; fall back to the configured language only
          // when it names one, and to English when neither does.
          speechLanguage:
            result.language ??
            (current.speechLanguage === "auto" ? "en" : current.speechLanguage)
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
          automaticPaste: settingsStore.get().automaticPaste,
          restoreClipboard: settingsStore.get().restoreClipboard,
          restoreClipboardDelayMs: settingsStore.get().restoreClipboardDelayMs,
          pressEnterAfterPaste: settingsStore.get().pressEnterAfterPaste,
        });
        return outcome.ok ? outcome.value : { inserted: false };
      },
    });

    const currentLocOpt = getLocaleOptions(settingsStore.get());

    overlay = createOverlayWindowController({
      e2e,
      initialPosition: settingsStore.get().overlayPosition,
      onPositionChange: (position) => {
        settingsStore.update({ overlayPosition: position });
      },
      isLiveTranscriptionEnabled: () => settingsStore.get().liveTranscription,
      locale: currentLocOpt.locale,
      dir: currentLocOpt.dir
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
      onToggleMeeting: () => {
        if (isMeetingActive(meetings.state)) {
          void meetings.stop();
        } else {
          void meetings.start();
        }
      },
      onOpenMainWindow: () => { showMainWindow(settingsStore.get()); },
      onSetHotkeysPaused: (paused) => hotkeys?.setPaused(paused),
      onQuit: () => {
        app.quit();
      },
      onCopyTranscript: (text) => {
        clipboard.writeText(text);
      },
      engineDisplayName: () => engines.get(primaryEngineId)?.displayName ?? MOCK_ENGINE.displayName,
    });
    tray.setLocale(currentLocOpt.locale);

    // Dictation always wins. The meeting worker finishes the utterance it is
    // on and then holds until the capture is done.
    session.subscribe((state) => {
      meetings.setDictationActive(state.phase !== "idle" && state.phase !== "error");
    });

    meetings.subscribe((state) => {
      tray.setMeetingState(state);
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(meetingStateChangedChannel, state);
        }
      }
      overlay?.updateMeeting(state);
    });

    settingsStore.subscribe((latest) => {
      const locOpt = getLocaleOptions(latest);
      tray.setLocale(locOpt.locale);
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
      onMeetingToggle: () => {
        if (isMeetingActive(meetings.state)) {
          void meetings.stop();
        } else {
          void meetings.start();
        }
      },
    });

    // Apply the configured hotkeys and re-register at runtime when the user
    // changes them in Settings. The PTT hook chord is applied immediately;
    // the toggle and meeting accelerators re-register via globalShortcut.
    hotkeys.setHotkeys(
      settingsStore.get().pttAccelerator,
      settingsStore.get().toggleAccelerator,
      settingsStore.get().meeting.accelerator
    );
    settingsStore.subscribe((latest) => {
      hotkeys?.setHotkeys(
        latest.pttAccelerator,
        latest.toggleAccelerator,
        latest.meeting.accelerator
      );
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
      mainWindow = createMainWindow(getLocaleOptions(settingsStore.get()));
      mainWindow.on("close", (event) => {
        if (!isQuitting) {
          // Close hides, it does not quit. Quit from the tray or Ctrl+Q.
          event.preventDefault();
          if (mainWindow !== null) {
            mainWindow.hide();
          }
          if (!settingsStore.get().firstHideNotified) {
            settingsStore.update({ firstHideNotified: true });
            tray.notifyFirstHide();
          }
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

  /**
   * Shutdown steps are independent, so one failure must not skip the rest.
   *
   * Every step here is hygiene: the OS reclaims windows, hooks, native memory
   * and file handles regardless. What is NOT recoverable is an exception
   * escaping will-quit, because Electron surfaces that as a JavaScript error
   * dialog. On the update path that dialog appears instead of the installer
   * running, so a throw in a cleanup step turns a working update into a
   * visible crash. Each step is therefore isolated and merely logged.
   */
  const shutdownStep = (name: string, run: () => void): void => {
    try {
      run();
    } catch (error) {
      console.warn(`[quit] ${name} failed.`, error);
    }
  };

  app.on("will-quit", () => {
    shutdownStep("Overlay dispose", () => overlay?.dispose());
    shutdownStep("Hotkey dispose", () => hotkeys?.dispose());
    shutdownStep("Meeting dispose", () => meetingSession?.dispose());
    shutdownStep("Updater dispose", () => updaterController?.dispose());
    shutdownStep("Engine dispose", () => {
      void primaryLocalEngine?.dispose();
    });
    primaryLocalEngine = null;
    shutdownStep("Database close", () => database?.close());
    database = null;
  });
}
