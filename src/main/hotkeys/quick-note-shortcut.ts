import { globalShortcut } from "electron";
import { DEFAULT_QUICK_NOTE_ACCELERATOR } from "../../shared/hotkeys";
import { shouldAttemptRegister } from "./toggle-shortcut";
import type { ShortcutBinder } from "./toggle-shortcut";

interface QuickNoteState { accelerator: string; registered: boolean; attempted: boolean }
const state: QuickNoteState = { accelerator: DEFAULT_QUICK_NOTE_ACCELERATOR, registered: false, attempted: false };

export const registerQuickNoteShortcut = (callback: () => void, accelerator = state.accelerator, binder: ShortcutBinder = globalShortcut): boolean => {
  if (!shouldAttemptRegister(accelerator, state)) return state.registered;
  if (state.registered) unregisterQuickNoteShortcut(binder);
  state.accelerator = accelerator;
  state.attempted = true;
  state.registered = binder.register(accelerator, callback);
  if (!state.registered) console.warn(`[hotkeys] Could not register quick note shortcut "${accelerator}".`);
  return state.registered;
};

export const unregisterQuickNoteShortcut = (binder: ShortcutBinder = globalShortcut): void => {
  if (state.registered) binder.unregister(state.accelerator);
  state.registered = false;
  state.attempted = false;
};
