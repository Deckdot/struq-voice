import { contextBridge, ipcRenderer } from "electron";
import type { MainWindowApi } from "../shared/api";
import type {
  HistoryListRequest,
  HistorySearchRequest,
  HistoryDeleteRequest,
  HistoryListResult,
  HistorySearchResult,
  HistoryDeleteResult,
  HistoryClearResult,
  ModelsModelRequest,
  ModelsListResult,
  ModelsModelResult,
  ModelsDownloadProgressEvent,
  SettingsGetResult,
  SettingsUpdateResult,
  SettingsChangedEvent
} from "../shared/ipc";
import type { PreloadChannels } from "../shared/ipc";
import type { Settings } from "../shared/settings";

/**
 * Sandboxed preloads cannot load shared modules (the bundle must be one
 * self-contained file), so main serialises the channel names from
 * src/shared/ipc.ts into the window's additionalArguments. Read them here.
 */
const readChannels = (argv: readonly string[]): PreloadChannels => {
  const arg = argv.find((entry) => entry.startsWith("--struq-channels="));
  if (arg === undefined) {
    throw new Error("missing --struq-channels argument in preload argv");
  }
  return JSON.parse(arg.slice("--struq-channels=".length)) as PreloadChannels;
};

const channels = readChannels(process.argv);

const api: MainWindowApi = {
  windowKind: "main",
  getAppVersion: () => ipcRenderer.invoke(channels.appGetVersion),
  window: {
    minimize: () => {
      ipcRenderer.send(channels.window.minimize);
    },
    toggleMaximize: () => {
      ipcRenderer.send(channels.window.toggleMaximize);
    },
    close: () => {
      ipcRenderer.send(channels.window.close);
    }
  },
  onCaptureStateChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown): void => {
      listener(state as never);
    };
    ipcRenderer.on(channels.captureStateChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.captureStateChanged, handler);
    };
  },
  history: {
    list: (request: HistoryListRequest) =>
      ipcRenderer.invoke(channels.history.list, request) as Promise<HistoryListResult>,
    search: (request: HistorySearchRequest) =>
      ipcRenderer.invoke(channels.history.search, request) as Promise<HistorySearchResult>,
    remove: (request: HistoryDeleteRequest) =>
      ipcRenderer.invoke(channels.history.delete, request) as Promise<HistoryDeleteResult>,
    clear: () =>
      ipcRenderer.invoke(channels.history.clear) as Promise<HistoryClearResult>
  },
  models: {
    list: () =>
      ipcRenderer.invoke(channels.models.list) as Promise<ModelsListResult>,
    download: (request: ModelsModelRequest) =>
      ipcRenderer.invoke(channels.models.download, request) as Promise<ModelsModelResult>,
    cancel: (request: ModelsModelRequest) =>
      ipcRenderer.invoke(channels.models.cancel, request) as Promise<ModelsModelResult>,
    remove: (request: ModelsModelRequest) =>
      ipcRenderer.invoke(channels.models.delete, request) as Promise<ModelsModelResult>,
    installRuntime: () =>
      ipcRenderer.invoke(channels.models.installRuntime) as Promise<ModelsModelResult>,
    onDownloadProgress: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: ModelsDownloadProgressEvent
      ): void => {
        listener(payload);
      };
      ipcRenderer.on(channels.models.downloadProgress, handler);
      return () => {
        ipcRenderer.removeListener(channels.models.downloadProgress, handler);
      };
    }
  },
  clipboard: {
    copy: (text: string) => {
      ipcRenderer.send(channels.clipboard.copy, text);
    }
  },
  settings: {
    get: () =>
      ipcRenderer.invoke(channels.settings.get) as Promise<SettingsGetResult>,
    update: (patch: Partial<Settings>) =>
      ipcRenderer.invoke(channels.settings.update, {
        patch: patch as Record<string, unknown>
      }) as Promise<SettingsUpdateResult>,
    onChange: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: SettingsChangedEvent
      ): void => {
        listener(payload.settings);
      };
      ipcRenderer.on(channels.settings.changed, handler);
      return () => {
        ipcRenderer.removeListener(channels.settings.changed, handler);
      };
    }
  },
  openRouterKey: {
    status: () =>
      ipcRenderer.invoke(channels.openRouterKey.status) as Promise<{
        configured: boolean;
        stored: boolean;
      }>,
    set: (key: string) =>
      ipcRenderer.invoke(channels.openRouterKey.set, { key }) as Promise<{
        ok: boolean;
        message?: string;
      }>,
    clear: () =>
      ipcRenderer.invoke(channels.openRouterKey.clear) as Promise<{
        ok: boolean;
        message?: string;
      }>
  },
  devices: {
    list: () =>
      ipcRenderer.invoke(channels.devices.list) as Promise<{
        devices: readonly { deviceId: string; label: string }[];
        currentDeviceId: string | null;
      }>,
    setDevice: (deviceId: string) => {
      ipcRenderer.send(channels.recorder.setDevice, { deviceId });
    }
  }
};

contextBridge.exposeInMainWorld("struqVoice", api);
