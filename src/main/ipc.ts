import { readFile, writeFile } from "node:fs/promises";
import { BrowserWindow, app, clipboard, dialog, ipcMain } from "electron";
import type { HistoryStore } from "./db/history-store";
import type { ModelsService } from "./models";
import type { SecretsStore } from "./store/secrets";
import type { SettingsStore } from "./store/settings-store";
import { ONBOARDING_VERSION, dictionaryFileSchema, migrateSettings } from "../shared/settings";
import type { HardwareProfile, ModelRecommendation } from "../shared/hardware";
import { UNKNOWN_HARDWARE, recommendModel } from "../shared/hardware";
import type {
  AppReadiness,
  DevicesListResult,
  DictionaryExportResult,
  DictionaryFile,
  DictionaryImportResult,
  HistoryDeleteRequest,
  HistoryListRequest,
  HistorySearchRequest,
  HistoryStatsResult,
  ModelsModelRequest,
  OnboardingCompleteResult,
  OnboardingProfileResult,
  OnboardingStartRecommendedResult,
  OpenRouterKeySetRequest,
  OverlayMoveRequest,
  RecorderDevice,
  SettingsUpdateRequest,
  UpdatesInstallResult,
  UpdatesStateResult
} from "../shared/ipc";
import {
  appGetReadinessChannel,
  appGetVersionChannel,
  dictionaryExportChannel,
  dictionaryImportChannel,
  onboardingCompleteChannel,
  onboardingProfileChannel,
  onboardingStartRecommendedChannel,
  clipboardCopyChannel,
  devicesListChannel,
  historyClearChannel,
  historyDeleteChannel,
  historyListChannel,
  historySearchChannel,
  historyStatsChannel,
  modelsCancelChannel,
  modelsDeleteChannel,
  modelsDownloadChannel,
  modelsDownloadProgressChannel,
  modelsInstallRuntimeChannel,
  modelsListChannel,
  modelsImportChannel,
  metricsMeasuredRtfChannel,
  openRouterKeyClearChannel,
  openRouterKeySetChannel,
  openRouterKeyStatusChannel,
  recorderDevicesChannel,
  recorderGetDevicesChannel,
  recorderSetDeviceChannel,
  settingsChangedChannel,
  settingsGetChannel,
  settingsUpdateChannel,
  updatesCheckChannel,
  updatesGetChannel,
  updatesInstallChannel,
  windowCloseChannel,
  windowMinimizeChannel,
  windowToggleMaximizeChannel,
  overlayMoveChannel
} from "../shared/ipc";
import { INITIAL_UPDATE_STATE } from "../shared/updates";
import type { UpdaterController } from "./updater";

/**
 * Thin typed dispatch only. All channel names and payload types come from
 * src/shared/ipc.ts; no logic beyond forwarding to the window, process or
 * store.
 */
export interface OnboardingDeps {
  /** Null until detection resolves; the recommendation falls back meanwhile. */
  readonly getHardware: () => HardwareProfile | null;
}

/** The overlay controls the panel owns that the renderer can ask for. */
export interface OverlayDeps {
  readonly moveTo: (x: number, y: number) => void;
}

/** The readiness snapshot the UI can poll or subscribe to. */
export interface ReadinessDeps {
  readonly getReadiness: () => AppReadiness;
}

const SAFE_EMPTY_READINESS: AppReadiness = {
  microphone: { live: false },
  hotkeysActive: false
};

const EMPTY_HISTORY_STATS: HistoryStatsResult = {
  todayWords: 0,
  todayDurationMs: 0,
  todayCount: 0,
  wpm: 0,
  streakDays: 0,
  totalTranscripts: 0,
  totalWords: 0,
  totalDurationMs: 0,
  daily: []
};

export const registerIpcHandlers = (
  history: HistoryStore | null,
  models: ModelsService | null,
  settingsStore: SettingsStore | null,
  secrets: SecretsStore | null,
  updater: UpdaterController | null = null,
  onboarding: OnboardingDeps | null = null,
  overlay: OverlayDeps | null = null,
  readiness: ReadinessDeps | null = null
): void => {
  const currentVersion = app.getVersion();

  /**
   * One place decides what this machine should run, so the profile handler
   * and the "start it" handler can never disagree about which model that is.
   */
  const currentRecommendation = (): ModelRecommendation =>
    recommendModel(onboarding?.getHardware() ?? UNKNOWN_HARDWARE);

  ipcMain.handle(onboardingProfileChannel, (): OnboardingProfileResult => {
    const recommendation = currentRecommendation();
    const listed = models?.list();
    const status = listed?.items.find((item) => item.model.id === recommendation.modelId);
    return {
      hardware: onboarding?.getHardware() ?? null,
      recommendation,
      modelInstalled: status?.installed ?? false
    };
  });

  ipcMain.handle(
    onboardingStartRecommendedChannel,
    (): OnboardingStartRecommendedResult => {
      const recommendation = currentRecommendation();
      if (settingsStore === null || models === null) {
        return {
          modelId: recommendation.modelId,
          started: false,
          message: "Models are unavailable in this session."
        };
      }

      // Point the engine at the model before the download starts, so a
      // capture that lands mid-download resolves against the right engine.
      const settings = settingsStore.get();
      settingsStore.update({
        engine: { ...settings.engine, primary: recommendation.engineId },
        ...(recommendation.engineId === "whisper-cpp"
          ? { whisperModelId: recommendation.modelId }
          : {})
      });

      const listed = models.list();
      const status = listed.items.find((item) => item.model.id === recommendation.modelId);
      if (status?.installed === true) {
        return { modelId: recommendation.modelId, started: false, message: "Already installed." };
      }
      return { modelId: recommendation.modelId, started: models.startDownload(recommendation.modelId) };
    }
  );

  ipcMain.handle(onboardingCompleteChannel, (): OnboardingCompleteResult => {
    settingsStore?.update({
      onboarding: {
        completed: true,
        completedVersion: ONBOARDING_VERSION,
        hardware: onboarding?.getHardware() ?? null
      }
    });
    return { settings: settingsStore?.get() ?? migrateSettings({}) };
  });

  ipcMain.handle(
    updatesGetChannel,
    (): UpdatesStateResult => ({
      state: updater?.getState() ?? INITIAL_UPDATE_STATE,
      currentVersion
    })
  );

  ipcMain.handle(updatesCheckChannel, async (): Promise<UpdatesStateResult> => {
    if (updater === null) {
      return { state: INITIAL_UPDATE_STATE, currentVersion };
    }
    return { state: await updater.check(), currentVersion };
  });

  ipcMain.handle(
    updatesInstallChannel,
    (): UpdatesInstallResult => ({ started: updater?.install() ?? false })
  );

  ipcMain.handle(appGetVersionChannel, () => app.getVersion());

  ipcMain.handle(
    appGetReadinessChannel,
    (): AppReadiness => readiness?.getReadiness() ?? SAFE_EMPTY_READINESS
  );

  ipcMain.handle(openRouterKeyStatusChannel, async () => {
    if (secrets === null) return { configured: false, stored: false };
    const key = await secrets.readOpenRouterKey();
    const stored = await secrets.hasStoredOpenRouterKey();
    return { configured: key !== null && key.length > 0, stored };
  });

  ipcMain.handle(
    openRouterKeySetChannel,
    async (_event, request: OpenRouterKeySetRequest) => {
      if (secrets === null) return { ok: false, message: "Secrets unavailable." };
      const outcome = await secrets.writeOpenRouterKey(request.key);
      return outcome.ok
        ? { ok: true }
        : { ok: false, message: outcome.error.message };
    }
  );

  ipcMain.handle(openRouterKeyClearChannel, async () => {
    if (secrets === null) return { ok: false, message: "Secrets unavailable." };
    const outcome = await secrets.clearOpenRouterKey();
    return outcome.ok
      ? { ok: true }
      : { ok: false, message: outcome.error.message };
  });

  ipcMain.on(windowMinimizeChannel, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(windowToggleMaximizeChannel, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) return;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.on(windowCloseChannel, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  ipcMain.on(overlayMoveChannel, (_event, request: OverlayMoveRequest) => {
    overlay?.moveTo(request.x, request.y);
  });

  ipcMain.handle(historyListChannel, (_event, request: HistoryListRequest) => {
    if (history === null) return { items: [] };
    return {
      items: history.listRecent(request.limit ?? 50, request.offset ?? 0)
    };
  });

  ipcMain.handle(historySearchChannel, (_event, request: HistorySearchRequest) => {
    if (history === null) return { items: [] };
    return { items: history.search(request.query, request.limit ?? 50) };
  });

  ipcMain.handle(historyDeleteChannel, (_event, request: HistoryDeleteRequest) => {
    if (history === null) return { ok: false };
    return { ok: history.remove(request.id) };
  });

  ipcMain.handle(historyClearChannel, () => {
    history?.removeAll();
    return { ok: true };
  });

  // Without a database there is nothing to count, so the dashboard shows
  // zeroes rather than failing: history is a degradable feature.
  ipcMain.handle(historyStatsChannel, () => history?.stats() ?? EMPTY_HISTORY_STATS);

  ipcMain.handle(metricsMeasuredRtfChannel, () => {
    return { byEngine: history?.measuredRtf() ?? {} };
  });

  ipcMain.on(clipboardCopyChannel, (_event, text: string) => {
    clipboard.writeText(text);
  });

  // Device list and selection relay through the recorder window, which owns
  // the microphone and therefore the enumerated device labels.
  const findRecorderWindow = (): BrowserWindow | undefined =>
    BrowserWindow.getAllWindows().find((candidate) =>
      candidate.webContents.getURL().includes("recorder/index.html"),
    );

  ipcMain.handle(devicesListChannel, async (): Promise<DevicesListResult> => {
    const recorder = findRecorderWindow();
    if (recorder === undefined) return { devices: [], currentDeviceId: null };
    return await new Promise<DevicesListResult>((resolve) => {
      let settled = false;
      const finish = (result: DevicesListResult): void => {
        if (!settled) {
          settled = true;
          ipcMain.removeListener(recorderDevicesChannel, onDevices);
          resolve(result);
        }
      };
      const onDevices = (
        _event: Electron.IpcMainEvent,
        payload:
          | { devices?: readonly RecorderDevice[]; currentDeviceId?: string | null }
          | undefined
      ): void => {
        finish({
          devices: [...(payload?.devices ?? [])],
          currentDeviceId: payload?.currentDeviceId ?? null
        });
      };
      ipcMain.on(recorderDevicesChannel, onDevices);
      recorder.webContents.send(recorderGetDevicesChannel);
      setTimeout(() => {
        finish({ devices: [], currentDeviceId: null });
      }, 1500);
    });
  });

  ipcMain.on(
    recorderSetDeviceChannel,
    (_event, request: { deviceId: string }) => {
      findRecorderWindow()?.webContents.send(recorderSetDeviceChannel, request.deviceId);
    }
  );

  ipcMain.handle(modelsListChannel, () => {
    const listed = models?.list();
    return listed === undefined
      ? { items: [], totalDiskUsed: 0, whisperRuntime: { state: "idle" } }
      : {
          items: listed.items,
          totalDiskUsed: listed.totalDiskUsed,
          whisperRuntime: listed.whisperRuntime
        };
  });

  ipcMain.handle(modelsInstallRuntimeChannel, async () => {
    if (models === null) return { ok: false };
    await models.installWhisperRuntime();
    return { ok: true };
  });

  ipcMain.handle(
    modelsImportChannel,
    async (_event, request: ModelsModelRequest) => {
      if (models === null) return { ok: false, message: "Models unavailable." };
      const picked = await dialog.showOpenDialog({
        title: "Import model files",
        properties: ["openDirectory"]
      });
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false, message: "Import cancelled." };
      }
      const outcome = await models.importFromDirectory(request.modelId, picked.filePaths[0] ?? "");
      return outcome.ok
        ? { ok: true }
        : { ok: false, message: outcome.error.message };
    }
  );

  ipcMain.handle(modelsDownloadChannel, (_event, request: ModelsModelRequest) => {
    return { ok: models?.startDownload(request.modelId) ?? false };
  });

  ipcMain.handle(modelsCancelChannel, (_event, request: ModelsModelRequest) => {
    return { ok: models?.cancelDownload(request.modelId) ?? false };
  });

  ipcMain.handle(
    modelsDeleteChannel,
    async (_event, request: ModelsModelRequest) => {
      return { ok: (await models?.deleteModel(request.modelId)) ?? false };
    }
  );

  ipcMain.handle(settingsGetChannel, () => {
    return { settings: settingsStore?.get() ?? migrateSettings({}) };
  });

  ipcMain.handle(
    settingsUpdateChannel,
    (_event, request: SettingsUpdateRequest) => {
      settingsStore?.update(request.patch);
      return { settings: settingsStore?.get() ?? migrateSettings({}) };
    }
  );

  ipcMain.handle(dictionaryExportChannel, async (): Promise<DictionaryExportResult> => {
    if (settingsStore === null) return { ok: false, message: "Settings unavailable." };
    const picked = await dialog.showSaveDialog({
      title: "Export dictionary",
      defaultPath: "struq-voice-dictionary.json",
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (picked.canceled || picked.filePath.length === 0) {
      return { ok: false, message: "Export cancelled." };
    }
    const file: DictionaryFile = {
      kind: "struq-voice-dictionary",
      version: 1,
      entries: settingsStore.get().post.dictionary
    };
    await writeFile(picked.filePath, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    return { ok: true, path: picked.filePath };
  });

  ipcMain.handle(dictionaryImportChannel, async (): Promise<DictionaryImportResult> => {
    if (settingsStore === null) {
      return { ok: false, added: 0, skipped: 0, message: "Settings unavailable." };
    }
    const picked = await dialog.showOpenDialog({
      title: "Import dictionary file",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (picked.canceled || picked.filePaths.length === 0 || picked.filePaths[0] === undefined) {
      return { ok: false, added: 0, skipped: 0, message: "Import cancelled." };
    }
    try {
      const content = await readFile(picked.filePaths[0], "utf8");
      const json: unknown = JSON.parse(content);
      const parsed = dictionaryFileSchema.safeParse(json);
      if (!parsed.success) {
        return { ok: false, added: 0, skipped: 0, message: "Invalid dictionary file format." };
      }
      const current = settingsStore.get();
      const existing = current.post.dictionary;
      const existingFromSet = new Set(existing.map((e) => e.from.toLowerCase()));
      let added = 0;
      let skipped = 0;
      const newEntries = [...existing];

      for (const entry of parsed.data.entries) {
        if (existingFromSet.has(entry.from.toLowerCase())) {
          skipped++;
        } else {
          existingFromSet.add(entry.from.toLowerCase());
          newEntries.push(entry);
          added++;
        }
      }

      settingsStore.update({
        post: { ...current.post, dictionary: newEntries }
      });
      return { ok: true, added, skipped };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to read file.";
      return { ok: false, added: 0, skipped: 0, message };
    }
  });

  if (settingsStore !== null) {
    settingsStore.subscribe((settings) => {
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes("main/index.html"),
      );
      if (window === undefined) return;
      window.webContents.send(settingsChangedChannel, { settings });
    });
  }

  if (models !== null) {
    models.subscribe((listed) => {
      const window = BrowserWindow.getAllWindows().find((candidate) =>
        candidate.webContents.getURL().includes("main/index.html"),
      );
      if (window === undefined) return;
      for (const status of listed.items) {
        if (status.download.state === "downloading") {
          window.webContents.send(modelsDownloadProgressChannel, {
            modelId: status.model.id,
            receivedBytes: status.download.receivedBytes,
            totalBytes: status.download.totalBytes,
          });
        }
      }
    });
  }
};
