/**
 * The recorder window: hidden, never focused, always alive. From Phase 2 it
 * owns the microphone permanently, which makes capture start free (the stream
 * is already warm) and structurally avoids the uiohook-napi issue where the
 * global keyboard hook dies when getUserMedia initialises while a window is
 * focused, because this window is never focused.
 */

import { BrowserWindow } from "electron";
import { join } from "node:path";

export const createRecorderWindow = (): BrowserWindow => {
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
      preload: join(__dirname, "../preload/recorder.cjs")
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
