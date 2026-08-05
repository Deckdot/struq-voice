/**
 * The global capture toggle. Default Ctrl+Shift+Space; reconfigurable through
 * the key-capture widget in Settings.
 * globalShortcut fires on key-down only, which is exactly right for a toggle.
 */

import { globalShortcut } from "electron";
import { DEFAULT_TOGGLE_ACCELERATOR } from "../../shared/hotkeys";

let current = DEFAULT_TOGGLE_ACCELERATOR;
let registered = false;

export const registerToggleShortcut = (callback: () => void, accelerator = current): boolean => {
  // Re-registering the same accelerator is a no-op; a different one must be
  // unregistered first or globalShortcut refuses the new binding.
  if (registered && accelerator === current) return true;
  if (registered) unregisterToggleShortcut();
  current = accelerator;
  const ok = globalShortcut.register(current, callback);
  registered = ok;
  if (!ok) {
    console.warn(
      `[hotkeys] Could not register toggle shortcut "${current}". It may already be bound to another application.`
    );
  }
  return ok;
};

export const unregisterToggleShortcut = (): void => {
  if (registered) {
    globalShortcut.unregister(current);
  }
  registered = false;
};
