import { contextBridge } from "electron";

const api = {
  windowKind: "overlay" as const,
};

contextBridge.exposeInMainWorld("struqVoice", api);
