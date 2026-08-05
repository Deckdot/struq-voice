import { contextBridge, ipcRenderer } from "electron";
import type { MainWindowApi } from "../shared/api";
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
  }
};

contextBridge.exposeInMainWorld("struqVoice", api);
