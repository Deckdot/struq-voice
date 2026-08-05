/**
 * Press-and-hold detection via uiohook-napi.
 *
 * globalShortcut has no key-up event, so PTT requires a low-level hook.
 * The decision logic is a pure function so it is unit tested; the wiring
 * around it only maps events to actions and never blocks. The chord is
 * configurable through the key-capture widget in Settings.
 */

import { uIOhook } from "uiohook-napi";
import type { UiohookKeyboardEvent } from "uiohook-napi";
import type { PttChord } from "../../shared/hotkeys";
import { formatChord } from "../../shared/hotkeys";

export interface PttKeyboardEvent {
  readonly keycode: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export type PttAction = "start" | "stop" | "none";
export type PttEventKind = "down" | "up";

export const DEFAULT_CHORD: PttChord = {
  keycode: 57, // UiohookKey.Space
  ctrlKey: true,
  shiftKey: false,
  altKey: false,
  metaKey: false
};

const MODIFIER_KEYCODES = new Set([29, 157, 42, 54, 56, 3640, 3675]);

/** Whether the event's modifier state matches the chord exactly. */
export const matchesChordModifiers = (
  event: PttKeyboardEvent,
  chord: PttChord
): boolean =>
  event.ctrlKey === chord.ctrlKey &&
  event.shiftKey === chord.shiftKey &&
  event.altKey === chord.altKey &&
  event.metaKey === chord.metaKey;

/**
 * Decide the action for one hook event against the current press state.
 *
 * - keydown of the trigger key with the chord held and nothing active: start.
 * - further keydowns while active: ignore (Windows key repeat).
 * - keyup of the trigger key while active: stop (the matching keyup).
 * - keyup of any chord modifier while active: stop. The user broke the
 *   chord, so the capture must end even if the trigger key never came up.
 */
export const decidePttAction = (
  event: PttKeyboardEvent,
  kind: PttEventKind,
  active: boolean,
  chord: PttChord = DEFAULT_CHORD
): PttAction => {
  const isTrigger = event.keycode === chord.keycode;
  if (kind === "down") {
    if (isTrigger && !active && matchesChordModifiers(event, chord)) return "start";
    return "none";
  }
  if (isTrigger && active) return "stop";
  if (MODIFIER_KEYCODES.has(event.keycode) && active) return "stop";
  return "none";
};

export interface PttHookCallbacks {
  readonly onStart: () => void;
  readonly onStop: () => void;
}

export interface PttHookOptions {
  readonly chord: PttChord;
}

export interface PttHook {
  start: () => void;
  stop: () => void;
  /** Re-point the hook at a new chord without restarting uIOhook. */
  setChord: (chord: PttChord) => void;
  readonly active: boolean;
  readonly display: string;
}

export const createPttHook = (
  callbacks: PttHookCallbacks,
  options: PttHookOptions = { chord: DEFAULT_CHORD }
): PttHook => {
  let active = false;
  let started = false;
  let chord = options.chord;

  const handle = (event: UiohookKeyboardEvent, kind: PttEventKind): void => {
    // Never block in the hook callback: it runs on the hook thread. Slow
    // work here makes the user's entire keyboard feel laggy.
    const action = decidePttAction(event, kind, active, chord);
    if (action === "start") {
      active = true;
      callbacks.onStart();
    } else if (action === "stop") {
      active = false;
      callbacks.onStop();
    }
  };

  const onKeyDown = (event: UiohookKeyboardEvent): void => {
    handle(event, "down");
  };
  const onKeyUp = (event: UiohookKeyboardEvent): void => {
    handle(event, "up");
  };

  return {
    start: () => {
      if (started) return;
      uIOhook.on("keydown", onKeyDown);
      uIOhook.on("keyup", onKeyUp);
      uIOhook.start();
      started = true;
    },
    stop: () => {
      if (!started) return;
      uIOhook.stop();
      uIOhook.removeListener("keydown", onKeyDown);
      uIOhook.removeListener("keyup", onKeyUp);
      started = false;
      active = false;
    },
    setChord: (next: PttChord) => {
      chord = next;
    },
    get active(): boolean {
      return active;
    },
    get display(): string {
      return formatChord(chord);
    }
  };
};
