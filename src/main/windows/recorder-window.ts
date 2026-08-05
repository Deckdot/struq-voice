/**
 * The recorder window: hidden, never focused, always alive. From Phase 2 it
 * owns the microphone permanently, which makes capture start free (the stream
 * is already warm) and structurally avoids the uiohook-napi issue where the
 * global keyboard hook dies when getUserMedia initialises while a window is
 * focused, because this window is never focused.
 */

import { BrowserWindow } from "electron";
import { join } from "node:path";
import { PRELOAD_CHANNELS } from "../../shared/ipc";

export interface RecorderWindowOptions {
  /** E2E mode skips the microphone entirely. */
  readonly e2e: boolean;
}

const channelsArg = `--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`;

export const createRecorderWindow = (options: RecorderWindowOptions): BrowserWindow => {
  const e2eArg = options.e2e ? "--struq-e2e" : null;
  const window = new BrowserWindow({
    width: 480,
    height: 360,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "../preload/recorder.cjs"),
      // The sandboxed preload reads channel names and the e2e flag from
      // argv; channels are declared in src/shared/ipc.ts and nowhere else.
      additionalArguments: [channelsArg, ...(e2eArg !== null ? [e2eArg] : [])]
    }
  });

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/recorder/index.html`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/recorder/index.html"));
  }

  return window;
};
