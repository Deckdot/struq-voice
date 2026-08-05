import { app } from "electron";

/**
 * Windows autostart via Electron's login item settings. The app is
 * tray-resident, so when it starts with Windows it must start hidden: the
 * main window is not created on boot in that case (index.ts decides based on
 * the app's own rules). This module only manages the flag.
 */

export interface AutostartController {
  setEnabled: (enabled: boolean) => void;
}

export const AUTOSTART_HIDDEN_ARG = "--struq-start-hidden";

export const isAutostartLaunch = (argv: readonly string[] = process.argv): boolean =>
  argv.includes(AUTOSTART_HIDDEN_ARG);

export const createAutostart = (): AutostartController => {
  const setEnabled = (enabled: boolean): void => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      args: [AUTOSTART_HIDDEN_ARG]
    });
  };

  return {
    setEnabled
  };
};
