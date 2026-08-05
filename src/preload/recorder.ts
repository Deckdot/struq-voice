import { contextBridge, ipcRenderer } from "electron";
import type { RecorderDevice, RecorderWindowApi } from "../shared/api";
import type { PreloadChannels } from "../shared/ipc";

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
const e2e = process.argv.includes("--struq-e2e");

const api: RecorderWindowApi = {
  windowKind: "recorder",
  isE2E: e2e,
  onBeginCapture: (callback: () => void) => {
    const wrapped = (): void => { callback(); };
    ipcRenderer.on(channels.recorder.begin, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.recorder.begin, wrapped);
    };
  },
  onEndCapture: (callback: () => void) => {
    const wrapped = (): void => { callback(); };
    ipcRenderer.on(channels.recorder.end, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.recorder.end, wrapped);
    };
  },
  sendCaptureData: (data: {
    pcm: ArrayBuffer;
    durationMs: number;
    sampleRate: number;
  }) => {
    ipcRenderer.send(channels.recorder.data, data, [data.pcm]);
  },
  sendLevels: (data: { bands: readonly number[]; level: number }) => {
    ipcRenderer.send(channels.recorder.levels, data);
  },
  sendStreamState: (data: { live: boolean; reason?: string }) => {
    ipcRenderer.send(channels.recorder.streamState, data);
  },
  onPlaySound: (callback: (data: { bytes: ArrayBuffer; volume: number }) => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { bytes: ArrayBuffer; volume: number }
    ): void => {
      callback(payload);
    };
    ipcRenderer.on(channels.recorder.playSound, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.recorder.playSound, wrapped);
    };
  },
  onSnapshotRequest: (callback: (sequence: number) => void) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: { sequence: number }
    ): void => {
      callback(payload.sequence);
    };
    ipcRenderer.on(channels.recorder.snapshotRequest, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.recorder.snapshotRequest, wrapped);
    };
  },
  sendSnapshotData: (data: {
    pcm: ArrayBuffer;
    durationMs: number;
    sampleRate: number;
    sequence: number;
  }) => {
    ipcRenderer.send(channels.recorder.snapshotData, data, [data.pcm]);
  },
  onSetDevice: (callback: (deviceId: string) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, deviceId: string): void => {
      callback(deviceId);
    };
    ipcRenderer.on(channels.recorder.setDevice, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.recorder.setDevice, wrapped);
    };
  },
  onGetDevices: (callback: () => void) => {
    const wrapped = (): void => {
      callback();
    };
    ipcRenderer.on(channels.recorder.getDevices, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.recorder.getDevices, wrapped);
    };
  },
  sendDevices: (devices: readonly RecorderDevice[], currentDeviceId: string | null) => {
    // Main reads payload.devices, so the array must be wrapped. Sending it
    // bare makes the handler destructure undefined and the list comes back empty.
    ipcRenderer.send(channels.recorder.devices, {
      devices: [...devices],
      currentDeviceId
    });
  }
};

contextBridge.exposeInMainWorld("struqVoice", api);
