import type { WindowApi } from "../../shared/api";

declare global {
  interface Window {
    struqVoice: WindowApi;
  }
}

export {};
