import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MainWindowApi } from "../shared/api";
import type { CaptureStateChangedEvent } from "../shared/ipc";
import { PRELOAD_CHANNELS } from "../shared/ipc";

type IpcListener = (event: unknown, payload: never) => void;

const ipcListeners = new Map<string, Set<IpcListener>>();
const exposed: { api?: MainWindowApi } = {};

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: MainWindowApi): void => {
      exposed.api = api;
    }
  },
  ipcRenderer: {
    invoke: vi.fn(),
    on: (channel: string, listener: IpcListener): void => {
      const listeners = ipcListeners.get(channel) ?? new Set<IpcListener>();
      listeners.add(listener);
      ipcListeners.set(channel, listeners);
    },
    removeListener: (channel: string, listener: IpcListener): void => {
      ipcListeners.get(channel)?.delete(listener);
    },
    send: vi.fn()
  }
}));

const readExposedApi = (): MainWindowApi => {
  const api = exposed.api;
  if (api === undefined) throw new Error("Main preload did not expose its API");
  return api;
};

const loadPreload = async (): Promise<MainWindowApi> => {
  vi.resetModules();
  ipcListeners.clear();
  delete exposed.api;
  process.argv.push(`--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`);
  await import("./main");
  process.argv.length--;
  return readExposedApi();
};

beforeEach(() => {
  ipcListeners.clear();
  delete exposed.api;
});

describe("main preload capture state", () => {
  it("unwraps the broadcast payload before notifying the renderer", async () => {
    const api = await loadPreload();
    const listener = vi.fn();
    api.onCaptureStateChanged(listener);
    const payload: CaptureStateChangedEvent = {
      state: { phase: "delivering", text: "Fresh transcript", inserted: true },
      liveTranscription: false
    };

    for (const subscribed of ipcListeners.get(PRELOAD_CHANNELS.captureStateChanged) ?? []) {
      subscribed({}, payload as never);
    }

    expect(listener).toHaveBeenCalledWith(payload.state);
  });
});
