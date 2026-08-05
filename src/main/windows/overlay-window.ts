/**
 * The floating capture overlay window lifecycle. Ported from
 * StruqADE/apps/desktop/src/main/voice-overlay.ts. Read its comments in the
 * source before changing anything: several requirements are non-obvious.
 *
 * The properties that make the product work:
 *
 * - `focusable: false`. The overlay can never take focus, so the Windows
 *   foreground window never changes while it is visible. A synthesised Ctrl+V
 *   therefore lands in the app the user was actually in.
 * - `showInactive()`, never `show()`. `show()` steals focus and silently
 *   breaks paste delivery.
 * - `alwaysOnTop: true` in the constructor AND `setAlwaysOnTop(true,
 *   'floating')`. The constructor option alone is insufficient on Windows.
 * - Per-window `focus` AND `blur` listeners. `app.on('browser-window-focus')`
 *   alone is not enough; without the blur half the overlay stays hidden after
 *   the first round trip (record, leave, return, leave again).
 * - Lazy creation in a try/catch. Some locked-down Windows configurations
 *   block always-on-top windows; the fallback is a Notification.
 */

import { app, BrowserWindow, Notification, screen } from "electron";
import { join } from "node:path";
import type { CaptureState } from "../../shared/capture";
import { isActiveCapture } from "../../shared/capture";
import type { CaptureStateChangedEvent } from "../../shared/ipc";
import { captureStateChangedChannel, PRELOAD_CHANNELS } from "../../shared/ipc";

export const OVERLAY_WIDTH = 360;
export const OVERLAY_HEIGHT = 88;

const channelsArg = `--struq-channels=${JSON.stringify(PRELOAD_CHANNELS)}`;

export interface OverlayWindowOptions {
  /** Deterministic tests skip the focus-listener behaviour. */
  readonly e2e: boolean;
}

export interface OverlayWindowController {
  /** Reflect a capture state: show the pill for active states, hide for idle. */
  update: (state: CaptureState) => void;
  /** The live overlay window, or null before first use or after failure. */
  getWindow: () => BrowserWindow | null;
  /** Call on app before-quit. */
  dispose: () => void;
}

let overlayWindow: BrowserWindow | null = null;
let currentState: CaptureState = { phase: "idle" };

const createOverlayWindow = (): BrowserWindow => {
  // Position on the display containing the cursor: bottom-centre, 24px above
  // the work area.
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  const x = Math.floor(workArea.x + (workArea.width - OVERLAY_WIDTH) / 2);
  const y = Math.floor(workArea.y + workArea.height - OVERLAY_HEIGHT - 24);

  const window = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
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
      // The sandboxed preload reads channel names from argv; they are
      // declared in src/shared/ipc.ts and nowhere else.
      additionalArguments: [channelsArg]
    }
  });

  // The constructor option is a hint; this is the actual promotion on Windows.
  window.setAlwaysOnTop(true, "floating");

  const rendererUrl = process.env["ELECTRON_RENDERER_URL"];
  if (rendererUrl !== undefined) {
    void window.loadURL(`${rendererUrl}/overlay/index.html`);
  } else {
    void window.loadFile(join(__dirname, "../renderer/overlay/index.html"));
  }

  return window;
};

const ensureOverlayWindow = (): BrowserWindow | null => {
  if (overlayWindow !== null && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }
  try {
    overlayWindow = createOverlayWindow();
    return overlayWindow;
  } catch {
    overlayWindow = null;
    return null;
  }
};

const setOverlayVisible = (window: BrowserWindow | null, visible: boolean): void => {
  if (window === null) return;
  if (visible) {
    if (!window.isVisible()) {
      window.showInactive();
    }
  } else if (window.isVisible()) {
    window.hide();
  }
};

const broadcastState = (state: CaptureState): void => {
  const payload: CaptureStateChangedEvent = { state };
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(captureStateChangedChannel, payload);
    }
  }
};

let fallbackNotification: Notification | null = null;

const setFallbackNotification = (active: boolean): void => {
  if (active) {
    if (fallbackNotification !== null) return;
    try {
      const notification = new Notification({
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

/**
 * Focus / blur handling, ported from StruqADE: when one of our own windows has
 * focus the overlay stays hidden (the main window is the indicator there);
 * when the user is in another app the overlay shows. Without the blur half,
 * the overlay stays hidden after the first round trip.
 */
const windowsWithFocusListeners = new WeakSet<BrowserWindow>();

const reevaluateOverlayVisibility = (): void => {
  if (!isActiveCapture(currentState)) return;
  const focused = BrowserWindow.getFocusedWindow();
  const isOwnWindowFocused = focused !== null && focused !== overlayWindow;
  setOverlayVisible(overlayWindow, !isOwnWindowFocused);
};

const attachWindowFocusListeners = (window: BrowserWindow): void => {
  if (windowsWithFocusListeners.has(window)) return;
  windowsWithFocusListeners.add(window);
  window.on("focus", () => {
    if (window === overlayWindow) return;
    reevaluateOverlayVisibility();
  });
  window.on("blur", () => {
    if (window === overlayWindow) return;
    reevaluateOverlayVisibility();
  });
};

let focusListenerAttached = false;

const attachFocusListener = (): void => {
  app.on("browser-window-focus", (_event, window) => {
    attachWindowFocusListeners(window);
  });
  for (const window of BrowserWindow.getAllWindows()) {
    attachWindowFocusListeners(window);
  }
};

export const createOverlayWindowController = (
  options: OverlayWindowOptions
): OverlayWindowController => {
  return {
    update: (state: CaptureState): void => {
      currentState = state;

      if (!focusListenerAttached && !options.e2e) {
        attachFocusListener();
        focusListenerAttached = true;
      }

      broadcastState(state);

      const active = isActiveCapture(state);
      const window = ensureOverlayWindow();
      if (window === null) {
        // Overlay construction blocked (always-on-top policy). Fall back to a
        // Notification so the user still has a cross-app signal.
        setFallbackNotification(active);
        return;
      }
      if (fallbackNotification !== null) {
        fallbackNotification = null;
      }

      if (!active) {
        setOverlayVisible(window, false);
        return;
      }

      if (options.e2e) {
        // Tests need deterministic visibility; the focus-listener logic is
        // exercised manually and in StruqADE production.
        setOverlayVisible(window, true);
        return;
      }

      const focused = BrowserWindow.getFocusedWindow();
      const isOwnWindowFocused = focused !== null && focused !== window;
      setOverlayVisible(window, !isOwnWindowFocused);
    },
    getWindow: () => overlayWindow,
    dispose: () => {
      if (overlayWindow !== null && !overlayWindow.isDestroyed()) {
        overlayWindow.destroy();
      }
      overlayWindow = null;
    }
  };
};
