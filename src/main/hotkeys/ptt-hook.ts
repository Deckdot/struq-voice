/**
 * Press-and-hold detection via uiohook-napi.
 *
 * globalShortcut has no key-up event, so PTT requires a low-level hook.
 * The decision logic is a pure function so it is unit tested; the wiring
 * around it only maps events to actions and never blocks.
 */

import { uIOhook } from "uiohook-napi";
import type { UiohookKeyboardEvent } from "uiohook-napi";

export interface PttKeyboardEvent {
  readonly keycode: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export type PttAction = "start" | "stop" | "none";
export type PttEventKind = "down" | "up";

export const PTT_KEYCODE = 57; // UiohookKey.Space
const CTRL_KEYCODES = new Set([29, 157]); // left and right control

export const isPttChord = (event: PttKeyboardEvent): boolean =>
  event.ctrlKey && !event.shiftKey && !event.altKey && !event.metaKey;

/**
 * Decide the action for one hook event against the current press state.
 *
 * - keydown of the trigger key with the chord held and nothing active: start.
 * - further keydowns while active: ignore (Windows key repeat).
 * - keyup of the trigger key while active: stop (the matching keyup).
 * - keyup of Ctrl while active: stop. The user broke the chord, so the
 *   capture must end even if the trigger key never came up.
 */
export const decidePttAction = (
  event: PttKeyboardEvent,
  kind: PttEventKind,
  active: boolean
): PttAction => {
  const isTrigger = event.keycode === PTT_KEYCODE;
  if (kind === "down") {
    if (isTrigger && !active && isPttChord(event)) return "start";
    return "none";
  }
  if (isTrigger && active) return "stop";
  if (CTRL_KEYCODES.has(event.keycode) && !event.ctrlKey && active) return "stop";
  return "none";
};

export interface PttHookCallbacks {
  readonly onStart: () => void;
  readonly onStop: () => void;
}

export interface PttHook {
  start: () => void;
  stop: () => void;
  readonly active: boolean;
}

export const createPttHook = (callbacks: PttHookCallbacks): PttHook => {
  let active = false;
  let started = false;

  const handle = (event: UiohookKeyboardEvent, kind: PttEventKind): void => {
    // Never block in the hook callback: it runs on the hook thread. Slow
    // work here makes the user's entire keyboard feel laggy.
    const action = decidePttAction(event, kind, active);
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
    get active(): boolean {
      return active;
    }
  };
};
