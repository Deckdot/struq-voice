import { BrowserWindow, app, clipboard, dialog, ipcMain } from "electron";
import type { HistoryStore } from "./db/history-store";
import type { ModelsService } from "./models";
import type { SecretsStore } from "./store/secrets";
import type { SettingsStore } from "./store/settings-store";
import { migrateSettings } from "../shared/settings";
import type {
  DevicesListResult,
  HistoryDeleteRequest,
  HistoryListRequest,
  HistorySearchRequest,
  ModelsModelRequest,
  OpenRouterKeySetRequest,
  RecorderDevice,
  SettingsUpdateRequest
} from "../shared/ipc";
import {
  appGetVersionChannel,
  clipboardCopyChannel,
  devicesListChannel,
  historyClearChannel,
  historyDeleteChannel,
  historyListChannel,
  historySearchChannel,
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
  windowCloseChannel,
  windowMinimizeChannel,
  windowToggleMaximizeChannel
} from "../shared/ipc";

/**
 * Thin typed dispatch only. All channel names and payload types come from
 * src/shared/ipc.ts; no logic beyond forwarding to the window, process or
 * store.
 */
export const registerIpcHandlers = (
  history: HistoryStore | null,
  models: ModelsService | null,
  settingsStore: SettingsStore | null,
  secrets: SecretsStore | null
): void => {
  ipcMain.handle(appGetVersionChannel, () => app.getVersion());

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
    const devices = await new Promise<RecorderDevice[]>((resolve) => {
      let settled = false;
      const finish = (listed: RecorderDevice[]): void => {
        if (!settled) {
          settled = true;
          ipcMain.removeListener(recorderDevicesChannel, onDevices);
          resolve(listed);
        }
      };
      const onDevices = (_event: Electron.IpcMainEvent, payload: { devices: readonly RecorderDevice[] }): void => {
        finish([...payload.devices]);
      };
      ipcMain.on(recorderDevicesChannel, onDevices);
      recorder.webContents.send(recorderGetDevicesChannel);
      setTimeout(() => {
        finish([]);
      }, 1500);
    });
    return { devices, currentDeviceId: null };
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
