/**
 * The main window: frameless, created on demand, hidden rather than destroyed
 * on close so reopening from the tray is instant. Close-hiding itself is wired
 * in index.ts where the app-quitting state lives.
 */

import { BrowserWindow, nativeTheme } from "electron";
import { join } from "node:path";
import { PRELOAD_CHANNELS } from "../../shared/ipc";

const channelsArg = `--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`;

const windowBackgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? "#101214" : "#f4f3ee";

const themeArg = (): string =>
  nativeTheme.shouldUseDarkColors ? "--struq-theme=dark" : "--struq-theme=light";

export interface MainWindowOptions {
  readonly locale?: string;
  readonly dir?: "ltr" | "rtl";
}

export const createMainWindow = (options?: MainWindowOptions): BrowserWindow => {
  const locale = options?.locale ?? "en";
  const dir = options?.dir ?? "ltr";
  const localeArg = `--struq-locale=${locale}`;
  const dirArg = `--struq-dir=${dir}`;

  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: "Struq Voice",
    show: false,
    frame: false,
    // The window background, resolved from the current theme so there is no
    // flash of a mismatched colour before the renderer paints.
    backgroundColor: windowBackgroundColor(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "../preload/main.cjs"),
      // The sandboxed preload reads channel names, theme, locale and dir from argv;
      // they are declared in src/shared/ipc.ts and nowhere else.
      additionalArguments: [channelsArg, themeArg(), localeArg, dirArg]
    }
  });

  // Track the system theme while the window lives so the background keeps
  // matching the renderer, which switches its palette on nativeTheme changes.
  const onThemeUpdated = (): void => {
    if (!window.isDestroyed()) {
      window.setBackgroundColor(windowBackgroundColor());
    }
  };
  nativeTheme.on("updated", onThemeUpdated);
  window.on("closed", () => {
    nativeTheme.removeListener("updated", onThemeUpdated);
  });

  window.once("ready-to-show", () => {
    window.show();
  });

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl !== undefined) {
    // The dev server root is src/renderer, so every window must ask for its
    // own entry. Loading the bare origin serves a 404 page, not the app.
    void window.loadURL(`${rendererUrl}/main/index.html`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/main/index.html"));
  }

  return window;
};
