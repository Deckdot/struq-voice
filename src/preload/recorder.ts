import { contextBridge } from "electron";

const api = {
  windowKind: "recorder" as const,
};

contextBridge.exposeInMainWorld("struqVoice", api);
