import { contextBridge } from "electron";
import type { RecorderWindowApi } from "../shared/api";

const api: RecorderWindowApi = {
  windowKind: "recorder"
};

contextBridge.exposeInMainWorld("struqVoice", api);
