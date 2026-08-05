/**
 * The global capture toggle: Ctrl+Shift+Space.
 * globalShortcut fires on key-down only, which is exactly right for a toggle.
 */

import { globalShortcut } from "electron";

export const TOGGLE_SHORTCUT = "CommandOrControl+Shift+Space";

export const registerToggleShortcut = (callback: () => void): boolean => {
  const registered = globalShortcut.register(TOGGLE_SHORTCUT, callback);
  if (!registered) {
    console.warn(
      `[hotkeys] Could not register toggle shortcut "${TOGGLE_SHORTCUT}". It may already be bound to another application.`
    );
  }
  return registered;
};

export const unregisterToggleShortcut = (): void => {
  globalShortcut.unregister(TOGGLE_SHORTCUT);
};
