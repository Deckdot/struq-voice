import { contextBridge, ipcRenderer } from "electron";
import {
  appGetVersionChannel,
  windowCloseChannel,
  windowMinimizeChannel,
  windowToggleMaximizeChannel,
} from "../shared/ipc";

const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(appGetVersionChannel),
  window: {
    minimize: (): void => {
      ipcRenderer.send(windowMinimizeChannel);
    },
    toggleMaximize: (): void => {
      ipcRenderer.send(windowToggleMaximizeChannel);
    },
    close: (): void => {
      ipcRenderer.send(windowCloseChannel);
    },
  },
};

export type StruqVoiceApi = typeof api;

contextBridge.exposeInMainWorld("struqVoice", api);
