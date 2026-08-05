/**
 * Overlay panel placement geometry. Pure functions, no Electron: main passes
 * in the display work areas it reads from `screen`, so this is unit testable
 * and runs in any process.
 *
 * The problem worth solving here is a panel dragged onto a monitor that is
 * later unplugged. A restored position is only trustworthy if it still lands
 * on a display that exists, so every stored position is re-clamped on use
 * rather than at the time it was saved.
 */

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverlayPosition {
  readonly x: number;
  readonly y: number;
}

/** How much of the panel must remain on a display for a position to count. */
const MIN_VISIBLE_PX = 48;

const overlapArea = (a: Rect, b: Rect): number => {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
};

/** The work area holding most of the panel, or null when it is fully off-screen. */
export const findHostWorkArea = (
  panel: Rect,
  workAreas: readonly Rect[]
): Rect | null => {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const workArea of workAreas) {
    const area = overlapArea(panel, workArea);
    if (area > bestArea) {
      bestArea = area;
      best = workArea;
    }
  }
  return bestArea > 0 ? best : null;
};

/**
 * Keep a panel within a work area, leaving at least MIN_VISIBLE_PX on screen
 * in each axis. A panel larger than the display pins to the top-left corner
 * rather than producing an inverted range.
 */
export const clampToWorkArea = (panel: Rect, workArea: Rect): OverlayPosition => {
  const minX = workArea.x - panel.width + MIN_VISIBLE_PX;
  const maxX = workArea.x + workArea.width - MIN_VISIBLE_PX;
  const minY = workArea.y;
  const maxY = workArea.y + workArea.height - MIN_VISIBLE_PX;

  return {
    x: Math.round(Math.min(Math.max(panel.x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(panel.y, minY), Math.max(minY, maxY)))
  };
};

/** The default placement: bottom centre of the given work area. */
export const defaultPosition = (
  workArea: Rect,
  panelWidth: number,
  panelHeight: number,
  bottomGap = 24
): OverlayPosition => ({
  x: Math.floor(workArea.x + (workArea.width - panelWidth) / 2),
  y: Math.floor(workArea.y + workArea.height - panelHeight - bottomGap)
});

/**
 * Resolve where the panel should open. A stored position is honoured when it
 * still lands on a live display, and otherwise discarded in favour of the
 * default placement on `fallbackWorkArea`. This is what stops a panel that
 * was last used on a since-disconnected monitor from opening off-screen.
 */
export const resolveOverlayPosition = (
  stored: OverlayPosition | null,
  workAreas: readonly Rect[],
  fallbackWorkArea: Rect,
  panelWidth: number,
  panelHeight: number
): OverlayPosition => {
  if (stored !== null) {
    const panel: Rect = {
      x: stored.x,
      y: stored.y,
      width: panelWidth,
      height: panelHeight
    };
    const host = findHostWorkArea(panel, workAreas);
    if (host !== null) {
      return clampToWorkArea(panel, host);
    }
  }
  return defaultPosition(fallbackWorkArea, panelWidth, panelHeight);
};
