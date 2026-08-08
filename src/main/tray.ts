/**
 * The tray. StruqADE has no tray; this is new work per plan section 5.3.
 *
 * - Three icon states driven by the capture session: idle, recording,
 *   transcribing (16px plus @2x, generated from the theme tokens).
 * - Tooltip carries state and engine.
 * - Left click opens the main window. Starting a capture is the hotkey's job
 *   and the menu's Start Capture item; clicking the icon must never begin
 *   recording someone who only meant to open the app.
 * - Right click menu: start/stop, recent transcripts, the engine in use,
 *   open, settings, pause hotkeys, quit.
 * - Close hides instead of quitting; quit from the tray (or Ctrl+Q).
 */

import { Menu, Notification, Tray, nativeImage } from "electron";
import { join } from "node:path";
import type { CaptureState } from "../shared/capture";
import type { MeetingState } from "../shared/meeting";
import { isMeetingActive } from "../shared/meeting";
import { t, type MessageKey } from "../shared/i18n";

export interface TrayInput {
  readonly onToggleCapture: () => void;
  readonly onToggleMeeting: () => void;
  readonly onOpenMainWindow: () => void;
  readonly onSetHotkeysPaused: (paused: boolean) => void;
  readonly onQuit: () => void;
  readonly onCopyTranscript: (text: string) => void;
  readonly engineDisplayName: () => string;
}

export interface TrayController {
  setState: (state: CaptureState) => void;
  setMeetingState: (state: MeetingState) => void;
  setLocale: (locale: string) => void;
  setRecentTranscripts: (items: readonly { id: number; text: string }[]) => void;
  getMenuItemIds: () => readonly string[];
  getTooltip: () => string | null;
  /** One-time balloon, called the first time the main window hides. */
  notifyFirstHide: () => void;
}

const PHASE_KEY: Record<CaptureState["phase"], MessageKey> = {
  idle: "tray.phase.idle",
  arming: "tray.phase.arming",
  listening: "tray.phase.listening",
  transcribing: "tray.phase.transcribing",
  delivering: "tray.phase.delivering",
  error: "tray.phase.error"
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

  let currentLocale = "en";
  let state: CaptureState = { phase: "idle" };
  let meetingState: MeetingState = { phase: "idle" };
  let tray: Tray | null = null;
  let contextMenu: Menu | null = null;
  let tooltip: string | null = null;
  let balloonShown = false;
  let hotkeysPaused = false;
  let recentTranscripts: readonly { id: number; text: string }[] = [];

  const FRAME_COUNT = 10;
  const recordingFrames: Electron.NativeImage[] = [];
  for (let f = 0; f < FRAME_COUNT; f++) {
    const img = nativeImage.createFromPath(iconPath(`recording-frame-${String(f)}.png`));
    if (!img.isEmpty()) {
      recordingFrames.push(img);
    }
  }

  let animTimer: ReturnType<typeof setInterval> | null = null;

  const stopAnimation = (): void => {
    if (animTimer !== null) {
      clearInterval(animTimer);
      animTimer = null;
    }
  };

  const startAnimation = (): void => {
    if (animTimer !== null || recordingFrames.length === 0) return;
    let frameIdx = 0;
    animTimer = setInterval(() => {
      if (tray !== null && recordingFrames.length > 0) {
        const frame = recordingFrames[frameIdx % recordingFrames.length];
        if (frame !== undefined) {
          tray.setImage(frame);
        }
        frameIdx++;
      }
    }, 90);
  };

  const recentSubmenu = (): Electron.MenuItemConstructorOptions[] => {
    if (recentTranscripts.length === 0) {
      return [{ id: "recentEmpty", label: t(currentLocale, "tray.noTranscripts"), enabled: false }];
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
        ? t(currentLocale, "tray.stopCapture")
        : t(currentLocale, "tray.startCapture");
    const meetingActive = isMeetingActive(meetingState);
    const template: Electron.MenuItemConstructorOptions[] = [
      { id: "startStop", label: captureLabel, click: () => { input.onToggleCapture(); } },
      { type: "separator" },
      {
        id: "startStopMeeting",
        label: t(currentLocale, meetingActive ? "tray.stopMeeting" : "tray.startMeeting"),
        click: () => { input.onToggleMeeting(); }
      },
      { type: "separator" },
      { id: "recent", label: t(currentLocale, "tray.recentTranscripts"), submenu: recentSubmenu() },
      { type: "separator" },
      {
        // Reports the engine in use rather than offering a choice. Switching
        // engines can mean downloading a model or entering a key, which is a
        // Settings conversation, not a tray click.
        id: "engine",
        label: `${t(currentLocale, "tray.engine")}: ${input.engineDisplayName()}`,
        enabled: false
      },
      { type: "separator" },
      { id: "open", label: t(currentLocale, "tray.openApp"), click: () => { input.onOpenMainWindow(); } },
      { id: "settings", label: t(currentLocale, "tray.settings"), click: () => { input.onOpenMainWindow(); } },
      {
        id: "pauseHotkeys",
        label: t(currentLocale, "tray.pauseHotkeys"),
        type: "checkbox",
        checked: hotkeysPaused,
        click: (item) => {
          hotkeysPaused = item.checked;
          input.onSetHotkeysPaused(hotkeysPaused);
        }
      },
      { type: "separator" },
      { id: "quit", label: t(currentLocale, "tray.quit"), click: () => { input.onQuit(); } }
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

    if (state.phase === "listening" || state.phase === "arming") {
      startAnimation();
    } else {
      stopAnimation();
      const icon = nativeImage.createFromPath(iconPath(iconForState(state)));
      if (!icon.isEmpty()) {
        tray.setImage(icon);
      }
    }

    const stateStr = t(currentLocale, PHASE_KEY[state.phase]);
    const meetingSuffix = isMeetingActive(meetingState)
      ? ` ${t(currentLocale, "tray.phase.meeting")}`
      : "";
    tooltip = t(currentLocale, "tray.tooltip", {
      state: `${stateStr}${meetingSuffix}`,
      engine: input.engineDisplayName()
    });
    tray.setToolTip(tooltip);
    refreshMenu();
  };

  const setMeetingState = (next: MeetingState): void => {
    meetingState = next;
    if (tray === null) return;
    const stateStr = t(currentLocale, PHASE_KEY[state.phase]);
    const meetingSuffix = isMeetingActive(meetingState)
      ? ` ${t(currentLocale, "tray.phase.meeting")}`
      : "";
    tooltip = t(currentLocale, "tray.tooltip", {
      state: `${stateStr}${meetingSuffix}`,
      engine: input.engineDisplayName()
    });
    tray.setToolTip(tooltip);
    refreshMenu();
  };

  const setLocale = (locale: string): void => {
    currentLocale = locale;
    const stateStr = t(currentLocale, PHASE_KEY[state.phase]);
    const meetingSuffix = isMeetingActive(meetingState)
      ? ` ${t(currentLocale, "tray.phase.meeting")}`
      : "";
    tooltip = t(currentLocale, "tray.tooltip", {
      state: `${stateStr}${meetingSuffix}`,
      engine: input.engineDisplayName()
    });
    if (tray !== null) {
      tray.setToolTip(tooltip);
      refreshMenu();
    }
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
    setMeetingState,
    setLocale,
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
        const appIconPath = join(__dirname, "../../resources/icon.png");
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: "Struq Voice",
            body: "Struq Voice stays in the tray. Quit from the tray menu.",
            icon: appIconPath,
            silent: true
          });
          notification.show();
          setTimeout(() => {
            try {
              notification.close();
            } catch {
              // Non-critical cleanup
            }
          }, 2000);
        } else {
          tray.displayBalloon({
            title: "Struq Voice",
            content: "Struq Voice stays in the tray. Quit from the tray menu.",
            icon: appIconPath
          });
        }
      } catch {
        // Non-critical notification fallback
      }
    }
  };
};
