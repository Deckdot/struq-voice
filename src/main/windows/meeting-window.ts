/**
 * The meeting capture window: hidden, never focused, and created only while a
 * meeting runs. It owns the Windows loopback stream, a second microphone
 * stream, and the opus archive encoder.
 *
 * It is deliberately not the recorder window. That one owns the permanently
 * warm dictation microphone and gates the global keyboard hook; putting
 * getDisplayMedia, a second AudioContext and a MediaRecorder in it would put
 * the product's hot path behind a feature that is idle most of the time.
 */

import { BrowserWindow } from "electron";
import { join } from "node:path";
import { PRELOAD_CHANNELS } from "../../shared/ipc";

const channelsArg = `--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`;

export const createMeetingWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    frame: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The window is never shown, so Chromium would otherwise throttle its
      // timers and its MediaRecorder cadence to once a second. The audio
      // worklet runs on the real-time audio thread and is immune, but the
      // encoder and the message pump are not.
      backgroundThrottling: false,
      preload: join(__dirname, "../preload/meeting.cjs"),
      additionalArguments: [channelsArg]
    }
  });

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/meeting/index.html`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/meeting/index.html"));
  }

  return window;
};
