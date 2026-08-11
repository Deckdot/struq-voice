import { contextBridge, ipcRenderer } from "electron";
import type { MainWindowApi } from "../shared/api";
import type {
  AppReadiness,
  HistoryListRequest,
  HistorySearchRequest,
  HistoryDeleteRequest,
  HistoryListResult,
  HistorySearchResult,
  HistoryDeleteResult,
  HistoryClearResult,
  HistoryStatsResult,
  CaptureStateChangedEvent,
  MeetingAssetsResult,
  MeetingAssetProgressEvent,
  MeetingExportRequest,
  MeetingExportResult,
  MeetingGetRequest,
  MeetingGetResult,
  MeetingLevelsEvent,
  MeetingListRequest,
  MeetingListResult,
  MeetingPauseResult,
  MeetingRenameRequest,
  MeetingRenameSpeakerRequest,
  MeetingSearchRequest,
  MeetingSearchResult,
  MeetingSegmentAppendedEvent,
  MeetingSpeakersMergedEvent,
  MeetingSegmentsRequest,
  MeetingSegmentsResult,
  MeetingSimpleResult,
  MeetingStartResult,
  ModelsModelRequest,
  ModelsListResult,
  ModelsModelResult,
  ModelsDownloadProgressEvent,
  OnboardingProfileResult,
  OnboardingStartRecommendedResult,
  SettingsGetResult,
  SettingsUpdateResult,
  SettingsChangedEvent,
  DictionaryExportResult,
  DictionaryImportResult,
  UpdatesInstallResult,
  UpdatesStateResult
} from "../shared/ipc";
import type { PreloadChannels } from "../shared/ipc";
import type { MeetingState } from "../shared/meeting";
import type { Settings } from "../shared/settings";
import type { UpdateState } from "../shared/updates";

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

/**
 * A sandboxed preload gets only contextBridge, ipcRenderer, webFrame and
 * nativeImage from the electron module, so nativeTheme cannot be read here.
 * Main resolves the theme and serialises it into argv alongside the channels.
 * Falling back to light keeps a missing argument cosmetic rather than fatal.
 */
const readTheme = (argv: readonly string[]): "light" | "dark" =>
  argv.includes("--struq-theme=dark") ? "dark" : "light";

const readLocale = (argv: readonly string[]): string => {
  const arg = argv.find((entry) => entry.startsWith("--struq-locale="));
  return arg !== undefined ? arg.slice("--struq-locale=".length) : "en";
};

const readDir = (argv: readonly string[]): "ltr" | "rtl" => {
  const arg = argv.find((entry) => entry.startsWith("--struq-dir="));
  return arg === "--struq-dir=rtl" ? "rtl" : "ltr";
};

const channels = readChannels(process.argv);

const api: MainWindowApi = {
  windowKind: "main",
  initialTheme: readTheme(process.argv),
  initialLocale: readLocale(process.argv),
  initialDir: readDir(process.argv),
  getAppVersion: () => ipcRenderer.invoke(channels.appGetVersion),
  getReadiness: () =>
    ipcRenderer.invoke(channels.appReadiness.get) as Promise<AppReadiness>,
  onReadinessChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      state: AppReadiness
    ): void => {
      listener(state);
    };
    ipcRenderer.on(channels.appReadiness.changed, handler);
    return () => {
      ipcRenderer.removeListener(channels.appReadiness.changed, handler);
    };
  },
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
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: CaptureStateChangedEvent
    ): void => {
      listener(payload.state);
    };
    ipcRenderer.on(channels.captureStateChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.captureStateChanged, handler);
    };
  },
  onCaptureLevelsChanged: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { bands: readonly number[]; level: number }
    ): void => {
      listener(data);
    };
    ipcRenderer.on(channels.captureLevelsChanged, handler);
    return () => {
      ipcRenderer.removeListener(channels.captureLevelsChanged, handler);
    };
  },
  requestCaptureLevels: () => {
    ipcRenderer.send(channels.captureLevelsRequest, { wanted: true });
    let released = false;
    return () => {
      // Guard the release: a double call would unbalance main's count and
      // stop the loop while another meter is still on screen.
      if (released) return;
      released = true;
      ipcRenderer.send(channels.captureLevelsRequest, { wanted: false });
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
      ipcRenderer.invoke(channels.history.clear) as Promise<HistoryClearResult>,
    stats: () =>
      ipcRenderer.invoke(channels.history.stats) as Promise<HistoryStatsResult>
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
    import: (request: ModelsModelRequest) =>
      ipcRenderer.invoke(channels.models.import, request) as Promise<{
        ok: boolean;
        message?: string;
      }>,
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
  metrics: {
    measuredRtf: () =>
      ipcRenderer.invoke(channels.metrics.measuredRtf) as Promise<{
        byEngine: Record<string, number>;
      }>
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
  dictionary: {
    export: () =>
      ipcRenderer.invoke(channels.dictionary.export) as Promise<DictionaryExportResult>,
    import: () =>
      ipcRenderer.invoke(channels.dictionary.import) as Promise<DictionaryImportResult>
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
  },
  updates: {
    get: () => ipcRenderer.invoke(channels.updates.get) as Promise<UpdatesStateResult>,
    check: () => ipcRenderer.invoke(channels.updates.check) as Promise<UpdatesStateResult>,
    install: () =>
      ipcRenderer.invoke(channels.updates.install) as Promise<UpdatesInstallResult>,
    onChange: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void => {
        listener(state);
      };
      ipcRenderer.on(channels.updates.changed, handler);
      return () => {
        ipcRenderer.removeListener(channels.updates.changed, handler);
      };
    }
  },
  onboarding: {
    profile: () =>
      ipcRenderer.invoke(channels.onboarding.profile) as Promise<OnboardingProfileResult>,
    startRecommended: () =>
      ipcRenderer.invoke(
        channels.onboarding.startRecommended
      ) as Promise<OnboardingStartRecommendedResult>,
    complete: () =>
      ipcRenderer.invoke(channels.onboarding.complete) as Promise<SettingsGetResult>
  },
  meetings: {
    start: () =>
      ipcRenderer.invoke(channels.meeting.start) as Promise<MeetingStartResult>,
    stop: () =>
      ipcRenderer.invoke(channels.meeting.stop) as Promise<MeetingSimpleResult>,
    pause: () =>
      ipcRenderer.invoke(channels.meeting.pause) as Promise<MeetingPauseResult>,
    list: (request: MeetingListRequest) =>
      ipcRenderer.invoke(channels.meeting.list, request) as Promise<MeetingListResult>,
    get: (request: MeetingGetRequest) =>
      ipcRenderer.invoke(channels.meeting.get, request) as Promise<MeetingGetResult>,
    segments: (request: MeetingSegmentsRequest) =>
      ipcRenderer.invoke(channels.meeting.segments, request) as Promise<MeetingSegmentsResult>,
    search: (request: MeetingSearchRequest) =>
      ipcRenderer.invoke(channels.meeting.search, request) as Promise<MeetingSearchResult>,
    remove: (request: MeetingGetRequest) =>
      ipcRenderer.invoke(channels.meeting.delete, request) as Promise<MeetingSimpleResult>,
    rename: (request: MeetingRenameRequest) =>
      ipcRenderer.invoke(channels.meeting.rename, request) as Promise<MeetingSimpleResult>,
    renameSpeaker: (request: MeetingRenameSpeakerRequest) =>
      ipcRenderer.invoke(
        channels.meeting.renameSpeaker,
        request
      ) as Promise<MeetingSimpleResult>,
    export: (request: MeetingExportRequest) =>
      ipcRenderer.invoke(channels.meeting.export, request) as Promise<MeetingExportResult>,
    revealRecording: (request: MeetingGetRequest) =>
      ipcRenderer.invoke(
        channels.meeting.revealRecording,
        request
      ) as Promise<MeetingSimpleResult>,
    assets: () =>
      ipcRenderer.invoke(channels.meeting.assets) as Promise<MeetingAssetsResult>,
    installAssets: () =>
      ipcRenderer.invoke(channels.meeting.installAssets) as Promise<MeetingSimpleResult>,
    onStateChanged: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: MeetingState
      ): void => {
        listener(state);
      };
      ipcRenderer.on(channels.meeting.stateChanged, handler);
      return () => {
        ipcRenderer.removeListener(channels.meeting.stateChanged, handler);
      };
    },
    onSegmentAppended: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: MeetingSegmentAppendedEvent
      ): void => {
        listener(payload);
      };
      ipcRenderer.on(channels.meeting.segmentAppended, handler);
      return () => {
        ipcRenderer.removeListener(channels.meeting.segmentAppended, handler);
      };
    },
    onSpeakersMerged: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: MeetingSpeakersMergedEvent
      ): void => {
        listener(payload);
      };
      ipcRenderer.on(channels.meeting.speakersMerged, handler);
      return () => {
        ipcRenderer.removeListener(channels.meeting.speakersMerged, handler);
      };
    },
    onLevels: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: MeetingLevelsEvent
      ): void => {
        listener(payload);
      };
      ipcRenderer.on(channels.meeting.levels, handler);
      return () => {
        ipcRenderer.removeListener(channels.meeting.levels, handler);
      };
    },
    onAssetProgress: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: MeetingAssetProgressEvent
      ): void => {
        listener(payload);
      };
      ipcRenderer.on(channels.meeting.assetProgress, handler);
      return () => {
        ipcRenderer.removeListener(channels.meeting.assetProgress, handler);
      };
    }
  }
};

contextBridge.exposeInMainWorld("struqVoice", api);
