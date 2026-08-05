import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OverlayWindowApi } from "../shared/api";
import type { CaptureStateChangedEvent } from "../shared/ipc";
import { PRELOAD_CHANNELS } from "../shared/ipc";

type IpcListener = (event: unknown, payload: CaptureStateChangedEvent) => void;

const ipcListeners = new Map<string, Set<IpcListener>>();
const exposed: { api?: OverlayWindowApi } = {};

vi.mock("electron", () => ({
  contextBridge: {
    exposeInMainWorld: (_name: string, api: OverlayWindowApi): void => {
      exposed.api = api;
    }
  },
  ipcRenderer: {
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

const emitState = (payload: CaptureStateChangedEvent): void => {
  for (const listener of ipcListeners.get(PRELOAD_CHANNELS.captureStateChanged) ?? []) {
    listener({}, payload);
  }
};

const readExposedApi = (): OverlayWindowApi => {
  const api = exposed.api;
  if (api === undefined) throw new Error("Overlay preload did not expose its API");
  return api;
};

const loadPreload = async (): Promise<OverlayWindowApi> => {
  vi.resetModules();
  ipcListeners.clear();
  delete exposed.api;
  process.argv.push(`--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`);
  await import("./overlay");
  process.argv.pop();
  return readExposedApi();
};

beforeEach(() => {
  ipcListeners.clear();
  delete exposed.api;
});

describe("overlay preload capture state", () => {
  it("replays state received before the renderer subscribes", async () => {
    const api = await loadPreload();
    emitState({
      state: { phase: "listening", startedAtMs: 1000 },
      liveTranscription: true
    });

    const listener = vi.fn();
    api.onCaptureStateChanged(listener);

    expect(listener).toHaveBeenCalledWith(
      { phase: "listening", startedAtMs: 1000 },
      true
    );
  });

  it("replays the latest state across a renderer remount", async () => {
    const api = await loadPreload();
    emitState({
      state: { phase: "arming", reason: "warming stream" },
      liveTranscription: false
    });
    emitState({
      state: { phase: "listening", startedAtMs: 2000 },
      liveTranscription: false
    });

    const first = vi.fn();
    const unsubscribe = api.onCaptureStateChanged(first);
    unsubscribe();
    const second = vi.fn();
    api.onCaptureStateChanged(second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(
      { phase: "listening", startedAtMs: 2000 },
      false
    );
  });

  it("stops live updates after unsubscribe", async () => {
    const api = await loadPreload();
    const listener = vi.fn();
    const unsubscribe = api.onCaptureStateChanged(listener);

    emitState({
      state: { phase: "listening", startedAtMs: 3000 },
      liveTranscription: false
    });
    unsubscribe();
    emitState({ state: { phase: "idle" }, liveTranscription: false });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
