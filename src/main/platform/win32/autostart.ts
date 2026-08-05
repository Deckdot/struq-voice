import { app } from "electron";

/**
 * Windows autostart via Electron's login item settings. The app is
 * tray-resident, so when it starts with Windows it must start hidden: the
 * main window is not created on boot in that case (index.ts decides based on
 * the app's own rules). This module only manages the flag.
 */

export interface AutostartController {
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
}

export const createAutostart = (): AutostartController => {
  const setEnabled = (enabled: boolean): void => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      openAsHidden: true
    });
  };

  return {
    setEnabled,
    isEnabled: () => app.getLoginItemSettings().openAtLogin
  };
};
