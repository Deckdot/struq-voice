import { contextBridge, ipcRenderer } from "electron";
import type { MeetingWindowApi } from "../shared/api";
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

const api: MeetingWindowApi = {
  windowKind: "meeting",
  onBegin: (callback) => {
    const wrapped = (
      _event: Electron.IpcRendererEvent,
      payload: Parameters<typeof callback>[0]
    ): void => {
      callback(payload);
    };
    ipcRenderer.on(channels.meetingAudio.begin, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.meetingAudio.begin, wrapped);
    };
  },
  onStop: (callback) => {
    const wrapped = (): void => {
      callback();
    };
    ipcRenderer.on(channels.meetingAudio.stop, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.meetingAudio.stop, wrapped);
    };
  },
  onPause: (callback) => {
    const wrapped = (_event: Electron.IpcRendererEvent, paused: boolean): void => {
      callback(paused);
    };
    ipcRenderer.on(channels.meetingAudio.pause, wrapped);
    return () => {
      ipcRenderer.removeListener(channels.meetingAudio.pause, wrapped);
    };
  },
  sendFrames: (data) => {
    ipcRenderer.send(channels.meetingAudio.frames, data, [data.pcm]);
  },
  sendArchiveChunk: (data) => {
    ipcRenderer.send(channels.meetingAudio.archive, data, [data.bytes]);
  },
  sendState: (data) => {
    ipcRenderer.send(channels.meetingAudio.state, data);
  },
  sendLevels: (data) => {
    ipcRenderer.send(channels.meetingAudio.levels, data);
  }
};

contextBridge.exposeInMainWorld("struqVoice", api);
