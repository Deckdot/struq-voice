/**
 * The global meeting toggle. Default Ctrl+Shift+M; reconfigurable through
 * the key-capture widget in Settings.
 *
 * A sibling of toggle-shortcut.ts, sharing its "attempted once per
 * accelerator" behaviour but keeping its own module state. The two are not
 * generalised into one: toggle-shortcut carries module-level state that a
 * passing test suite depends on, and the churn is not worth it for a second
 * binding.
 */

import { globalShortcut } from "electron";
import { DEFAULT_MEETING_ACCELERATOR } from "../../shared/hotkeys";
import { shouldAttemptRegister } from "./toggle-shortcut";
import type { ShortcutBinder } from "./toggle-shortcut";

interface MeetingShortcutState {
  /** The accelerator currently held, or last attempted. */
  accelerator: string;
  /** Whether `accelerator` is actually bound right now. */
  registered: boolean;
  /** Whether `accelerator` has already been attempted since the last change. */
  attempted: boolean;
}

const state: MeetingShortcutState = {
  accelerator: DEFAULT_MEETING_ACCELERATOR,
  registered: false,
  attempted: false
};

export const registerMeetingShortcut = (
  callback: () => void,
  accelerator = state.accelerator,
  binder: ShortcutBinder = globalShortcut
): boolean => {
  if (!shouldAttemptRegister(accelerator, state)) return state.registered;

  if (state.registered) unregisterMeetingShortcut(binder);

  state.accelerator = accelerator;
  state.attempted = true;
  state.registered = binder.register(accelerator, callback);

  if (!state.registered) {
    console.warn(
      `[hotkeys] Could not register meeting shortcut "${accelerator}". It may already be bound to another application.`
    );
  }
  return state.registered;
};

export const unregisterMeetingShortcut = (
  binder: ShortcutBinder = globalShortcut
): void => {
  if (state.registered) {
    binder.unregister(state.accelerator);
  }
  state.registered = false;
  state.attempted = false;
};
