/**
 * Hotkey chords shared by the renderer (key-capture widget) and main (PTT
 * hook + toggle shortcut). The capture widget records a chord as an
 * accelerator string; main parses it back into a uiohook keycode and modifier
 * flags. Side-effect free, no Electron imports.
 */

export interface PttChord {
  readonly keycode: number;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export const DEFAULT_PTT_ACCELERATOR = "CommandOrControl+Space";
export const DEFAULT_TOGGLE_ACCELERATOR = "CommandOrControl+Shift+Space";
export const DEFAULT_MEETING_ACCELERATOR = "CommandOrControl+Shift+M";

/** Canonical key names (accelerator tokens) to uiohook keycodes. */
const KEYNAME_TO_KEYCODE: Record<string, number> = {
  Space: 57,
  Enter: 28,
  Tab: 15,
  Backspace: 14,
  Escape: 1,
  ArrowLeft: 57419,
  ArrowUp: 57416,
  ArrowRight: 57421,
  ArrowDown: 57424,
  Home: 3655,
  End: 3663,
  PageUp: 3657,
  PageDown: 3665,
  Insert: 3666,
  Delete: 3667,
  A: 30, B: 48, C: 46, D: 32, E: 18, F: 33, G: 34, H: 35,
  I: 23, J: 36, K: 37, L: 38, M: 50, N: 49, O: 24, P: 25,
  Q: 16, R: 19, S: 31, T: 20, U: 22, V: 47, W: 17, X: 45,
  Y: 21, Z: 44,
  "0": 11, "1": 2, "2": 3, "3": 4, "4": 5, "5": 6,
  "6": 7, "7": 8, "8": 9, "9": 10,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64,
  F7: 65, F8: 66, F9: 67, F10: 68, F11: 87, F12: 88,
  Comma: 51, Period: 52, Slash: 53, Semicolon: 39,
  Quote: 40, Backquote: 41, Minus: 12, Equal: 13,
  BracketLeft: 26, BracketRight: 27, Backslash: 43
};

/**
 * Parse an accelerator string ("CommandOrControl+Shift+Space") into a chord.
 * Returns null when the trigger key is unknown or the string is malformed.
 */
export const parseAccelerator = (accelerator: string): PttChord | null => {
  const tokens = accelerator.split("+").map((token) => token.trim());
  const last = tokens[tokens.length - 1];
  if (last === undefined) return null;
  const keycode = KEYNAME_TO_KEYCODE[last];
  if (keycode === undefined) return null;

  let ctrlKey = false;
  let shiftKey = false;
  let altKey = false;
  let metaKey = false;
  for (const token of tokens.slice(0, -1)) {
    switch (token) {
      case "CommandOrControl":
      case "Command":
      case "Control":
      case "Ctrl":
        ctrlKey = true;
        break;
      case "Shift":
        shiftKey = true;
        break;
      case "Alt":
        altKey = true;
        break;
      case "Meta":
        metaKey = true;
        break;
      default:
        return null;
    }
  }
  return { keycode, ctrlKey, shiftKey, altKey, metaKey };
};

/** The reverse: a chord to a display string, e.g. "Ctrl+Shift+Space". */
export const formatChord = (chord: PttChord): string => {
  const parts: string[] = [];
  if (chord.ctrlKey) parts.push("Ctrl");
  if (chord.shiftKey) parts.push("Shift");
  if (chord.altKey) parts.push("Alt");
  if (chord.metaKey) parts.push("Meta");
  const keyName = Object.entries(KEYNAME_TO_KEYCODE).find(
    ([, code]) => code === chord.keycode
  )?.[0];
  parts.push(keyName ?? `Key ${String(chord.keycode)}`);
  return parts.join("+");
};

/**
 * An accelerator as a Windows user reads it. Electron's portable
 * "CommandOrControl" spelling is correct on disk and meaningless on a keycap:
 * this app is Windows-only, so the key is Ctrl and the label should say so.
 */
export const formatAccelerator = (accelerator: string): string =>
  accelerator
    .split("+")
    .map((part) => {
      if (part === "CommandOrControl" || part === "CmdOrCtrl") return "Ctrl";
      if (part === "Control") return "Ctrl";
      if (part === "Meta" || part === "Super" || part === "Command" || part === "Cmd") {
        return "Win";
      }
      return part;
    })
    .join("+");

/**
 * The DOM key event fields the capture widget needs. Typed structurally so
 * shared stays usable under the node tsconfig (no DOM lib there).
 */
export interface DomKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/**
 * Map a DOM key event into an accelerator string for the capture widget.
 * The widget records the chord the user actually pressed, including the
 * trigger key, and this keeps the format identical to what main parses.
 */
export const domEventToAccelerator = (event: DomKeyEvent): string | null => {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.shiftKey) parts.push("Shift");
  if (event.altKey) parts.push("Alt");
  if (event.metaKey) parts.push("Meta");

  const key = event.key;
  let name: string | null = null;
  if (key === " ") name = "Space";
  else if (/^[a-zA-Z]$/.test(key)) name = key.toUpperCase();
  else if (/^[0-9]$/.test(key)) name = key;
  else if (key.startsWith("F") && /^F([1-9]|1[0-2])$/.test(key)) name = key;
  else if (key.startsWith("Arrow")) name = key;
  else if (key === "Enter" || key === "Tab") name = key;
  else if (key === "," || key === "." || key === "/" || key === ";" || key === "'") {
    name = { ",": "Comma", ".": "Period", "/": "Slash", ";": "Semicolon", "'": "Quote" }[key];
  }
  if (name === null) return null;
  parts.push(name);
  return parts.join("+");
};
