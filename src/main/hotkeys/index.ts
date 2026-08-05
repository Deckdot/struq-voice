/**
 * Hotkey orchestration: the PTT hook, the toggle shortcut, the during-capture
 * Escape cancel, and a pause switch (for games). Everything re-registers on
 * demand, and registration failures surface rather than being swallowed.
 */

import { app, globalShortcut } from "electron";
import { createPttHook, type PttHook } from "./ptt-hook";
import {
  registerToggleShortcut,
  unregisterToggleShortcut
} from "./toggle-shortcut";
import { parseAccelerator } from "../../shared/hotkeys";

export interface HotkeyInput {
  readonly e2e: boolean;
  readonly onPttStart: () => void;
  readonly onPttStop: () => void;
  readonly onToggle: () => void;
}

export interface HotkeyController {
  init: () => void;
  dispose: () => void;
  setPaused: (paused: boolean) => void;
  registerEscape: (onEscape: () => void) => void;
  unregisterEscape: () => void;
  /** Reconfigure PTT and toggle at runtime, without a restart. */
  setHotkeys: (pttAccelerator: string, toggleAccelerator: string) => void;
}

export const createHotkeys = (input: HotkeyInput): HotkeyController => {
  const pttHook: PttHook = createPttHook({
    onStart: input.onPttStart,
    onStop: input.onPttStop
  });

  let paused = false;
  let escapeRegistered = false;
  let escapeHandler: (() => void) | null = null;

  const setPaused = (next: boolean): void => {
    paused = next;
    if (paused) {
      pttHook.stop();
      unregisterToggleShortcut();
      unregisterEscape();
    } else {
      if (!input.e2e) {
        pttHook.start();
        registerToggleShortcut(input.onToggle);
      }
    }
  };

  const setHotkeys = (pttAccelerator: string, toggleAccelerator: string): void => {
    const chord = parseAccelerator(pttAccelerator);
    if (chord !== null) {
      pttHook.setChord(chord);
    }
    if (!paused && !input.e2e) {
      registerToggleShortcut(input.onToggle, toggleAccelerator);
    }
  };

  const registerEscape = (onEscape: () => void): void => {
    if (input.e2e || paused) return;
    if (escapeRegistered) {
      escapeHandler = onEscape;
      return;
    }
    escapeHandler = onEscape;
    const registered = globalShortcut.register("Escape", () => {
      escapeHandler?.();
    });
    if (registered) {
      escapeRegistered = true;
    } else {
      console.warn("[hotkeys] Could not register Escape as a cancel shortcut.");
    }
  };

  const unregisterEscape = (): void => {
    if (escapeRegistered) {
      globalShortcut.unregister("Escape");
      escapeRegistered = false;
    }
    escapeHandler = null;
  };

  return {
    init: () => {
      if (input.e2e) return;
      pttHook.start();
      registerToggleShortcut(input.onToggle);
      // Quit from the keyboard. The tray menu has the same action.
      const registered = globalShortcut.register("CommandOrControl+Q", () => {
        app.quit();
      });
      if (!registered) {
        console.warn("[hotkeys] Could not register CommandOrControl+Q as a quit shortcut.");
      }
    },
    dispose: () => {
      pttHook.stop();
      unregisterToggleShortcut();
      unregisterEscape();
      globalShortcut.unregister("CommandOrControl+Q");
    },
    setPaused,
    setHotkeys,
    registerEscape,
    unregisterEscape
  };
};
