/**
 * The global capture toggle. Default Ctrl+Shift+Space; reconfigurable through
 * the key-capture widget in Settings.
 * globalShortcut fires on key-down only, which is exactly right for a toggle.
 *
 * Boot calls this twice: once from hotkeys.init() with the default, then again
 * from setHotkeys() with the stored settings. Re-attempting an accelerator we
 * already tried is skipped, so an accelerator owned by another application is
 * reported once rather than on every call.
 */

import { globalShortcut } from "electron";
import { DEFAULT_TOGGLE_ACCELERATOR } from "../../shared/hotkeys";

/** The shape of `electron.globalShortcut` this module needs, so tests can fake it. */
export interface ShortcutBinder {
  register: (accelerator: string, callback: () => void) => boolean;
  unregister: (accelerator: string) => void;
}

interface ToggleState {
  /** The accelerator currently held, or last attempted. */
  accelerator: string;
  /** Whether `accelerator` is actually bound right now. */
  registered: boolean;
  /** Whether `accelerator` has already been attempted since the last change. */
  attempted: boolean;
}

const state: ToggleState = {
  accelerator: DEFAULT_TOGGLE_ACCELERATOR,
  registered: false,
  attempted: false
};

/**
 * Whether a register call should hit the OS. A repeat of an accelerator we
 * already attempted is skipped whether it succeeded (already bound) or failed
 * (another app owns it), which is what keeps the warning from repeating.
 */
export const shouldAttemptRegister = (
  next: string,
  current: { readonly accelerator: string; readonly attempted: boolean }
): boolean => !(current.attempted && next === current.accelerator);

export const registerToggleShortcut = (
  callback: () => void,
  accelerator = state.accelerator,
  binder: ShortcutBinder = globalShortcut
): boolean => {
  if (!shouldAttemptRegister(accelerator, state)) return state.registered;

  // A different accelerator must be released first or the new binding is refused.
  if (state.registered) unregisterToggleShortcut(binder);

  state.accelerator = accelerator;
  state.attempted = true;
  state.registered = binder.register(accelerator, callback);

  if (!state.registered) {
    console.warn(
      `[hotkeys] Could not register toggle shortcut "${accelerator}". It may already be bound to another application.`
    );
  }
  return state.registered;
};

export const unregisterToggleShortcut = (
  binder: ShortcutBinder = globalShortcut
): void => {
  if (state.registered) {
    binder.unregister(state.accelerator);
  }
  state.registered = false;
  // Cleared so a deliberate re-register of the same accelerator is attempted.
  state.attempted = false;
};

/** Test-only reset, so state does not leak between cases. */
export const resetToggleShortcutState = (): void => {
  state.accelerator = DEFAULT_TOGGLE_ACCELERATOR;
  state.registered = false;
  state.attempted = false;
};
