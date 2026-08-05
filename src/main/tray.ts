/**
 * The tray. StruqADE has no tray; this is new work per plan section 5.3.
 *
 * - Three icon states driven by the capture session: idle, recording,
 *   transcribing (16px plus @2x, generated from the theme tokens).
 * - Tooltip carries state and engine.
 * - Left click opens the main window. Starting a capture is the hotkey's job
 *   and the menu's Start Capture item; clicking the icon must never begin
 *   recording someone who only meant to open the app.
 * - Right click menu: start/stop, recent transcripts, engine radio group,
 *   open, settings, pause hotkeys, quit.
 * - Close hides instead of quitting; quit from the tray (or Ctrl+Q).
 */

import { Menu, Tray, nativeImage } from "electron";
import { join } from "node:path";
import type { CaptureState } from "../shared/capture";
import { MOCK_ENGINE } from "../shared/engines";

export interface TrayInput {
  readonly onToggleCapture: () => void;
  readonly onOpenMainWindow: () => void;
  readonly onSetHotkeysPaused: (paused: boolean) => void;
  readonly onQuit: () => void;
  readonly onCopyTranscript: (text: string) => void;
  readonly engineDisplayName: () => string;
}

export interface TrayController {
  setState: (state: CaptureState) => void;
  setRecentTranscripts: (items: readonly { id: number; text: string }[]) => void;
  getMenuItemIds: () => readonly string[];
  getTooltip: () => string | null;
  /** One-time balloon, called the first time the main window hides. */
  notifyFirstHide: () => void;
}

const PHASE_LABEL: Record<CaptureState["phase"], string> = {
  idle: "idle",
  arming: "arming",
  listening: "recording",
  transcribing: "transcribing",
  delivering: "delivering",
  error: "error"
};

const iconForState = (state: CaptureState): string => {
  switch (state.phase) {
    case "arming":
    case "listening":
      return "recording.png";
    case "transcribing":
    case "delivering":
      return "transcribing.png";
    default:
      return "idle.png";
  }
};

export const createTray = (input: TrayInput): TrayController => {
  const iconPath = (name: string): string =>
    join(__dirname, "../../resources/tray", name);

  let state: CaptureState = { phase: "idle" };
  let tray: Tray | null = null;
  let contextMenu: Menu | null = null;
  let tooltip: string | null = null;
  let balloonShown = false;
  let hotkeysPaused = false;
  let recentTranscripts: readonly { id: number; text: string }[] = [];

  const recentSubmenu = (): Electron.MenuItemConstructorOptions[] => {
    if (recentTranscripts.length === 0) {
      return [{ id: "recentEmpty", label: "No transcripts yet", enabled: false }];
    }
    return recentTranscripts.map((item) => ({
      id: `recent-${String(item.id)}`,
      label:
        item.text.length > 60 ? `${item.text.slice(0, 59)}\u2026` : item.text,
      click: () => { input.onCopyTranscript(item.text); }
    }));
  };

  const buildMenu = (): Menu => {
    const captureLabel =
      state.phase === "listening" || state.phase === "arming"
        ? "Stop Capture"
        : "Start Capture";
    const template: Electron.MenuItemConstructorOptions[] = [
      { id: "startStop", label: captureLabel, click: () => { input.onToggleCapture(); } },
      { type: "separator" },
      { id: "recent", label: "Recent transcripts", submenu: recentSubmenu() },
      { type: "separator" },
      {
        id: "engine",
        label: "Engine",
        submenu: [
          {
            id: "engineMock",
            label: `${MOCK_ENGINE.displayName} (test)`,
            type: "radio",
            checked: true
          }
        ]
      },
      { type: "separator" },
      { id: "open", label: "Open Struq Voice", click: () => { input.onOpenMainWindow(); } },
      { id: "settings", label: "Settings", click: () => { input.onOpenMainWindow(); } },
      {
        id: "pauseHotkeys",
        label: "Pause hotkeys",
        type: "checkbox",
        checked: hotkeysPaused,
        click: (item) => {
          hotkeysPaused = item.checked;
          input.onSetHotkeysPaused(hotkeysPaused);
        }
      },
      { type: "separator" },
      { id: "quit", label: "Quit", click: () => { input.onQuit(); } }
    ];
    return Menu.buildFromTemplate(template);
  };

  const refreshMenu = (): void => {
    if (tray === null) return;
    contextMenu = buildMenu();
    tray.setContextMenu(contextMenu);
  };

  const setState = (next: CaptureState): void => {
    state = next;
    if (tray === null) return;
    const icon = nativeImage.createFromPath(iconPath(iconForState(state)));
    if (!icon.isEmpty()) {
      tray.setImage(icon);
    }
    tooltip = `Struq Voice: ${PHASE_LABEL[state.phase]} (${input.engineDisplayName()})`;
    tray.setToolTip(tooltip);
    refreshMenu();
  };

  try {
    tray = new Tray(nativeImage.createFromPath(iconPath("idle.png")));
    contextMenu = buildMenu();
    tray.setContextMenu(contextMenu);
    tooltip = `Struq Voice: idle (${input.engineDisplayName()})`;
    tray.setToolTip(tooltip);
    // Left click opens the window. Capture belongs to the hotkey and to the
    // menu's Start Capture item: a tray icon is the app's front door, and a
    // stray click on it must never silently start recording the user.
    tray.on("click", () => { input.onOpenMainWindow(); });
    tray.on("double-click", () => { input.onOpenMainWindow(); });
  } catch (error) {
    console.warn("[tray] Could not create the tray icon.", error);
    tray = null;
    contextMenu = null;
    tooltip = null;
  }

  return {
    setState,
    setRecentTranscripts: (items: readonly { id: number; text: string }[]) => {
      recentTranscripts = items;
      refreshMenu();
    },
    getMenuItemIds: () => {
      if (contextMenu === null) return [];
      const ids: string[] = [];
      const walk = (items: Electron.MenuItem[]): void => {
        for (const item of items) {
          if (item.id !== "") ids.push(item.id);
          // Runtime reality: separators carry submenu === null, which the
          // Electron types deny. Optional chaining covers both.
          walk(item.submenu?.items ?? []);
        }
      };
      walk(contextMenu.items);
      return ids;
    },
    getTooltip: () => tooltip,
    notifyFirstHide: () => {
      if (balloonShown || tray === null) return;
      balloonShown = true;
      try {
        tray.displayBalloon({
          title: "Struq Voice",
          content: "Struq Voice stays in the tray. Quit from the tray menu."
        });
      } catch {
        // Balloons can fail on locked-down desktops. Non-critical.
      }
    }
  };
};
