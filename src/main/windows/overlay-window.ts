/**
 * The floating capture overlay window lifecycle. Ported from
 * StruqADE/apps/desktop/src/main/voice-overlay.ts. Read its comments in the
 * source before changing anything: several requirements are non-obvious.
 *
 * The properties that make the product work:
 *
 * - `focusable: false`. The overlay can never take focus, so the Windows
 *   foreground window never changes while it is visible. A synthesised Ctrl+V
 *   therefore lands in the app the user was actually in. This is also why the
 *   panel cannot be dragged by the OS or by -webkit-app-region: dragging is
 *   done by hand, in the renderer, through the move channel below.
 * - `showInactive()`, never `show()`. `show()` steals focus and silently
 *   breaks paste delivery.
 * - `alwaysOnTop: true` in the constructor AND `setAlwaysOnTop(true,
 *   'floating')`. The constructor option alone is insufficient on Windows.
 * - Lazy creation in a try/catch. Some locked-down Windows configurations
 *   block always-on-top windows; the fallback is a Notification.
 *
 * Visibility is decided by capture state alone. An earlier version also hid
 * the panel whenever one of our own windows had focus, on the theory that the
 * main window was the indicator there. That made the panel disappear exactly
 * when a user dictating into Struq Voice itself was watching it, so the rule
 * is gone: if a capture is active, the panel is on screen.
 */

import { BrowserWindow, Notification, nativeTheme, screen } from "electron";
import { join } from "node:path";
import type { CaptureState } from "../../shared/capture";
import { isActiveCapture } from "../../shared/capture";
import type { CaptureStateChangedEvent } from "../../shared/ipc";
import {
  captureStateChangedChannel,
  meetingStateChangedChannel,
  PRELOAD_CHANNELS
} from "../../shared/ipc";
import type { MeetingState } from "../../shared/meeting";
import { INITIAL_MEETING_STATE, isMeetingActive } from "../../shared/meeting";
import { t } from "../../shared/i18n";
import type { OverlayPosition, Rect } from "../../shared/overlay-position";
import {
  clampToWorkArea,
  defaultPosition,
  findHostWorkArea,
  resolveOverlayPosition
} from "../../shared/overlay-position";

/**
 * Notification-sized, and sized to what it actually shows. With the live
 * transcript off there is nothing but the visualiser and a timer, so the panel
 * is a compact strip; turning the transcript on grows it enough to read a few
 * lines. Reserving transcript space that stays empty just puts a large blank
 * well over the user's work.
 */
export const OVERLAY_WIDTH = 280;
export const OVERLAY_HEIGHT_COMPACT = 48;
export const OVERLAY_HEIGHT_TRANSCRIPT = 150;
export const OVERLAY_HEIGHT_MEETING = 132;

export const overlayHeight = (liveTranscription: boolean): number =>
  liveTranscription ? OVERLAY_HEIGHT_TRANSCRIPT : OVERLAY_HEIGHT_COMPACT;

const channelsArg = `--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`;

// nativeTheme is present in the real main process, but test harnesses stub the
// electron module and may omit it; treat it as optional.
const themeArg = (): string =>
  (nativeTheme as { readonly shouldUseDarkColors: boolean } | undefined)
    ?.shouldUseDarkColors === true
    ? "--struq-theme=dark"
    : "--struq-theme=light";

export interface OverlayWindowOptions {
  /** Deterministic tests skip timing-sensitive behaviour. */
  readonly e2e: boolean;
  /** Where the panel was last left, restored across restarts. */
  readonly initialPosition?: OverlayPosition | null;
  /** Called when the user finishes dragging, to persist the new position. */
  readonly onPositionChange?: (position: OverlayPosition) => void;
  /** Read at broadcast time: the setting can change between captures. */
  readonly isLiveTranscriptionEnabled?: () => boolean;
  readonly locale?: string;
  readonly dir?: "ltr" | "rtl";
}

export interface OverlayWindowController {
  /** Reflect a capture state: show the panel for active states, hide for idle. */
  update: (state: CaptureState) => void;
  /** Reflect meeting state in the same non-focusable feedback panel. */
  updateMeeting: (state: MeetingState) => void;
  /** The live overlay window, or null before first use or after failure. */
  getWindow: () => BrowserWindow | null;
  /** Move the panel to a screen position, clamped to a visible display. */
  moveTo: (x: number, y: number) => void;
  /** Forget the saved position and move the panel back to its default spot. */
  resetPosition: () => void;
  /** Call on app before-quit. */
  dispose: () => void;
}

let overlayWindow: BrowserWindow | null = null;

/**
 * The last state broadcast, replayed to the panel once its renderer is ready.
 *
 * The window is created lazily, on the first capture, and a capture starts by
 * broadcasting `listening` and showing the panel in the same tick. On a cold
 * start the renderer has not loaded yet, so that first broadcast arrives
 * before anything is listening for it and is lost: the panel came up blank on
 * the first capture of a session and worked on every one after, because by
 * then the window already existed.
 */
let lastState: CaptureState = { phase: "idle" };
let lastLiveTranscription = false;
let lastMeetingState: MeetingState = INITIAL_MEETING_STATE;

/**
 * Where the user last dragged the panel. Held in memory and pushed to the
 * caller's persistence hook, so it survives both the window being destroyed
 * between captures and a restart.
 */
let storedPosition: OverlayPosition | null = null;
let persistPosition: ((position: OverlayPosition) => void) | null = null;
// The settings write is trailing-debounced: a drag moves the panel per
// animation frame, and persisting every frame meant up to 60 synchronous
// settings-file writes (plus full settings broadcasts) per second on the
// main thread, which made the drag stutter. One write when the panel
// settles is the same guarantee with none of the churn.
let persistTimer: ReturnType<typeof setTimeout> | null = null;

const schedulePersist = (): void => {
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
  }
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (storedPosition !== null) {
      persistPosition?.(storedPosition);
    }
  }, 250);
};

const workAreas = (): Rect[] =>
  screen.getAllDisplays().map((display) => display.workArea);

const createOverlayWindow = (height: number, locale = "en", dir = "ltr"): BrowserWindow => {
  // The display under the cursor is where the user is working, so it is the
  // fallback when there is no usable stored position.
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const { x, y } = resolveOverlayPosition(
    storedPosition,
    workAreas(),
    workArea,
    OVERLAY_WIDTH,
    height
  );

  const window = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, "../preload/overlay.cjs"),
      // The sandboxed preload reads channel names, theme, locale and dir from argv;
      // they are declared in src/shared/ipc.ts and nowhere else.
      additionalArguments: [
        channelsArg,
        themeArg(),
        `--struq-locale=${locale}`,
        `--struq-dir=${dir}`
      ]
    }
  });

  // The constructor option is a hint; this is the actual promotion on Windows.
  window.setAlwaysOnTop(true, "floating");

  // Replay the current state as soon as the renderer can receive it. The
  // broadcast that started this capture went out before this window existed,
  // so without this the first capture of a session shows an empty panel.
  window.webContents.once("did-finish-load", () => {
    if (window.isDestroyed()) return;
    const payload: CaptureStateChangedEvent = {
      state: lastState,
      liveTranscription: lastLiveTranscription
    };
    window.webContents.send(captureStateChangedChannel, payload);
    window.webContents.send(meetingStateChangedChannel, lastMeetingState);
  });

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/overlay/index.html`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/overlay/index.html"));
  }

  return window;
};

const ensureOverlayWindow = (
  height: number,
  options?: OverlayWindowOptions
): BrowserWindow | null => {
  if (overlayWindow !== null && !overlayWindow.isDestroyed()) {
    // The setting can change between captures, so the window is resized to
    // match rather than rebuilt. Keep the top-left anchored: growing downward
    // from where the user parked the panel is less surprising than having it
    // creep upward.
    const bounds = overlayWindow.getBounds();
    if (bounds.height !== height) {
      overlayWindow.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: OVERLAY_WIDTH,
        height
      });
    }
    return overlayWindow;
  }
  try {
    overlayWindow = createOverlayWindow(height, options?.locale ?? "en", options?.dir ?? "ltr");
    return overlayWindow;
  } catch {
    overlayWindow = null;
    return null;
  }
};

let hideTimer: ReturnType<typeof setTimeout> | null = null;

const setOverlayVisible = (window: BrowserWindow | null, visible: boolean): void => {
  if (window === null) return;
  if (visible) {
    if (hideTimer !== null) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (!window.isVisible()) {
      window.showInactive();
    }
  } else if (window.isVisible() && hideTimer === null) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (!window.isDestroyed()) {
        window.hide();
      }
    }, 220);
  }
};

const broadcastState = (state: CaptureState, liveTranscription: boolean): void => {
  lastState = state;
  lastLiveTranscription = liveTranscription;
  const payload: CaptureStateChangedEvent = { state, liveTranscription };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(captureStateChangedChannel, payload);
    }
  }
};

let fallbackNotification: Notification | null = null;

const setFallbackNotification = (
  active: boolean,
  meeting: boolean,
  locale: string
): void => {
  if (active) {
    if (fallbackNotification !== null) return;
    try {
      const notification = meeting
        ? new Notification({ title: t(locale, "overlay.meetingRecording") })
        : new Notification({
            title: "Struq Voice is listening",
            body: "Release Ctrl+Space when done."
          });
      notification.show();
      fallbackNotification = notification;
    } catch {
      fallbackNotification = null;
    }
  } else {
    fallbackNotification = null;
  }
};

export const createOverlayWindowController = (
  options: OverlayWindowOptions
): OverlayWindowController => {
  storedPosition = options.initialPosition ?? null;
  persistPosition = options.onPositionChange ?? null;

  let meetingErrorVisible = false;
  let meetingErrorTimer: ReturnType<typeof setTimeout> | null = null;

  const syncVisibility = (): void => {
    const captureActive = isActiveCapture(lastState);
    const meetingActive = isMeetingActive(lastMeetingState);
    const height = captureActive
      ? overlayHeight(lastLiveTranscription)
      : OVERLAY_HEIGHT_MEETING;
    const window = ensureOverlayWindow(height, options);
    const visible = captureActive || meetingActive || meetingErrorVisible;
    if (window === null) {
      setFallbackNotification(
        visible,
        !captureActive && (meetingActive || meetingErrorVisible),
        options.locale ?? "en"
      );
      return;
    }
    if (fallbackNotification !== null) {
      fallbackNotification = null;
    }
    setOverlayVisible(window, visible);
  };

  return {
    update: (state: CaptureState): void => {
      const live = options.isLiveTranscriptionEnabled?.() ?? false;
      broadcastState(state, live);
      syncVisibility();
    },
    updateMeeting: (state: MeetingState): void => {
      lastMeetingState = state;
      meetingErrorVisible = state.phase === "error";
      if (meetingErrorTimer !== null) {
        clearTimeout(meetingErrorTimer);
        meetingErrorTimer = null;
      }
      if (meetingErrorVisible) {
        meetingErrorTimer = setTimeout(() => {
          meetingErrorTimer = null;
          meetingErrorVisible = false;
          syncVisibility();
        }, 4000);
      }
      syncVisibility();
    },
    getWindow: () => overlayWindow,
    moveTo: (x: number, y: number): void => {
      const window = overlayWindow;
      if (window === null || window.isDestroyed()) return;

      // Clamp against whichever display the panel is mostly over, so a drag
      // can cross monitors but cannot strand the panel off-screen. The height
      // is read from the window: it depends on whether the transcript shows.
      const panel: Rect = {
        x,
        y,
        width: OVERLAY_WIDTH,
        height: window.getBounds().height
      };
      const areas = workAreas();
      const host =
        findHostWorkArea(panel, areas) ??
        screen.getDisplayNearestPoint({ x, y }).workArea;
      const next = clampToWorkArea(panel, host);

      window.setPosition(next.x, next.y);
      storedPosition = next;
      schedulePersist();
    },
    resetPosition: (): void => {
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
      }
      storedPosition = null;
      // The window keeps living across captures, so moving it now makes the
      // reset visible immediately instead of only after a restart.
      if (overlayWindow !== null && !overlayWindow.isDestroyed()) {
        const cursor = screen.getCursorScreenPoint();
        const { workArea } = screen.getDisplayNearestPoint(cursor);
        const next = defaultPosition(
          workArea,
          OVERLAY_WIDTH,
          overlayWindow.getBounds().height
        );
        overlayWindow.setPosition(next.x, next.y);
      }
    },
    dispose: () => {
      if (meetingErrorTimer !== null) {
        clearTimeout(meetingErrorTimer);
        meetingErrorTimer = null;
      }
      // A drag that ended a moment before quit must still land in settings:
      // flush the debounced write now instead of losing the position.
      if (persistTimer !== null) {
        clearTimeout(persistTimer);
        persistTimer = null;
        if (storedPosition !== null) {
          persistPosition?.(storedPosition);
        }
      }
      if (overlayWindow !== null && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy();
      }
      overlayWindow = null;
    }
  };
};
