/**
 * The main window: frameless, created on demand, hidden rather than destroyed
 * on close so reopening from the tray is instant. Close-hiding itself is wired
 * in index.ts where the app-quitting state lives.
 */

import { BrowserWindow } from "electron";
import { join } from "node:path";
import { PRELOAD_CHANNELS } from "../../shared/ipc";

const channelsArg = `--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`;

export const createMainWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: "Struq Voice",
    show: false,
    frame: false,
    // The linen page colour, so there is no white flash before the renderer
    // paints. Matches --color-bg in the theme.
    backgroundColor: "#f6f4eb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "../preload/main.cjs"),
      // The sandboxed preload reads channel names from argv; they are
      // declared in src/shared/ipc.ts and nowhere else.
      additionalArguments: [channelsArg]
    }
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl !== undefined) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/main/index.html"));
  }

  return window;
};
