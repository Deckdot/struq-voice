import { BrowserWindow, app, ipcMain } from "electron";
import {
  appGetVersionChannel,
  windowCloseChannel,
  windowMinimizeChannel,
  windowToggleMaximizeChannel,
} from "../shared/ipc";

/**
 * Thin typed dispatch only. All channel names and payload types come from
 * src/shared/ipc.ts; no logic beyond forwarding to the window or process.
 */
export const registerIpcHandlers = (): void => {
  ipcMain.handle(appGetVersionChannel, () => app.getVersion());

  ipcMain.on(windowMinimizeChannel, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.on(windowToggleMaximizeChannel, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window === null) return;
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
  });

  ipcMain.on(windowCloseChannel, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
};
