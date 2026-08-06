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

const loadPreload = async (
  themeArg = "--struq-theme=light"
): Promise<OverlayWindowApi> => {
  vi.resetModules();
  ipcListeners.clear();
  delete exposed.api;
  process.argv.push(`--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`, themeArg);
  await import("./overlay");
  process.argv.length -= 2;
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

describe("overlay preload initial theme", () => {
  // nativeTheme does not exist in a sandboxed preload, so the theme has to
  // arrive through argv. Reading it from the electron module instead left the
  // overlay permanently light and threw outright in the main preload.
  it("reads dark from argv", async () => {
    const api = await loadPreload("--struq-theme=dark");
    expect(api.initialTheme).toBe("dark");
  });

  it("reads light from argv", async () => {
    const api = await loadPreload("--struq-theme=light");
    expect(api.initialTheme).toBe("light");
  });
});
