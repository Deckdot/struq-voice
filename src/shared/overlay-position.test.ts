import { describe, expect, it } from "vitest";
import type { Rect } from "./overlay-position";
import {
  clampToWorkArea,
  defaultPosition,
  findHostWorkArea,
  resolveOverlayPosition
} from "./overlay-position";

const PANEL_WIDTH = 460;
const PANEL_HEIGHT = 260;

/** A 1920x1080 primary with a taskbar, plus a second monitor to its left. */
const PRIMARY: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
const SECONDARY: Rect = { x: -1920, y: 0, width: 1920, height: 1080 };

describe("defaultPosition", () => {
  it("centres the panel horizontally above the bottom of the work area", () => {
    const position = defaultPosition(PRIMARY, PANEL_WIDTH, PANEL_HEIGHT);
    expect(position.x).toBe((1920 - PANEL_WIDTH) / 2);
    expect(position.y).toBe(1040 - PANEL_HEIGHT - 24);
  });

  it("respects a display that does not start at the origin", () => {
    const position = defaultPosition(SECONDARY, PANEL_WIDTH, PANEL_HEIGHT);
    expect(position.x).toBe(-1920 + (1920 - PANEL_WIDTH) / 2);
  });
});

describe("findHostWorkArea", () => {
  it("picks the display holding most of the panel", () => {
    // 300px of the 460px panel sits on the secondary, 160px on the primary.
    const panel: Rect = { x: -300, y: 100, width: PANEL_WIDTH, height: PANEL_HEIGHT };
    expect(findHostWorkArea(panel, [PRIMARY, SECONDARY])).toBe(SECONDARY);
  });

  it("picks the primary when the panel only just crosses the boundary", () => {
    const panel: Rect = { x: -200, y: 100, width: PANEL_WIDTH, height: PANEL_HEIGHT };
    expect(findHostWorkArea(panel, [PRIMARY, SECONDARY])).toBe(PRIMARY);
  });

  it("returns null when the panel is on no display at all", () => {
    const panel: Rect = { x: 9000, y: 9000, width: PANEL_WIDTH, height: PANEL_HEIGHT };
    expect(findHostWorkArea(panel, [PRIMARY, SECONDARY])).toBeNull();
  });
});

describe("clampToWorkArea", () => {
  it("leaves a panel that is already fully on screen alone", () => {
    const panel: Rect = { x: 400, y: 300, width: PANEL_WIDTH, height: PANEL_HEIGHT };
    expect(clampToWorkArea(panel, PRIMARY)).toEqual({ x: 400, y: 300 });
  });

  it("keeps a sliver on screen when dragged off the right edge", () => {
    const panel: Rect = { x: 5000, y: 300, width: PANEL_WIDTH, height: PANEL_HEIGHT };
    const { x } = clampToWorkArea(panel, PRIMARY);
    expect(x).toBe(1920 - 48);
    expect(x).toBeLessThan(1920);
  });

  it("keeps a sliver on screen when dragged off the left edge", () => {
    const panel: Rect = { x: -5000, y: 300, width: PANEL_WIDTH, height: PANEL_HEIGHT };
    const { x } = clampToWorkArea(panel, PRIMARY);
    expect(x).toBe(0 - PANEL_WIDTH + 48);
  });

  it("never lets the titlebar go above the work area", () => {
    const panel: Rect = { x: 400, y: -500, width: PANEL_WIDTH, height: PANEL_HEIGHT };
    expect(clampToWorkArea(panel, PRIMARY).y).toBe(0);
  });

  it("produces a usable range rather than inverting when the panel exceeds the display", () => {
    // A panel larger than the display would give minX > maxX if the clamp
    // were written naively; the max(minX, maxX) guard keeps it ordered.
    const tiny: Rect = { x: 0, y: 0, width: 100, height: 100 };
    const panel: Rect = { x: -9000, y: -9000, width: PANEL_WIDTH, height: PANEL_HEIGHT };
    const { x, y } = clampToWorkArea(panel, tiny);
    expect(x).toBe(-PANEL_WIDTH + 48);
    expect(y).toBe(0);
  });
});

describe("resolveOverlayPosition", () => {
  it("uses the default placement on first run", () => {
    const position = resolveOverlayPosition(
      null,
      [PRIMARY],
      PRIMARY,
      PANEL_WIDTH,
      PANEL_HEIGHT
    );
    expect(position).toEqual(defaultPosition(PRIMARY, PANEL_WIDTH, PANEL_HEIGHT));
  });

  it("honours a stored position that is still on a live display", () => {
    const stored = { x: 250, y: 180 };
    const position = resolveOverlayPosition(
      stored,
      [PRIMARY],
      PRIMARY,
      PANEL_WIDTH,
      PANEL_HEIGHT
    );
    expect(position).toEqual(stored);
  });

  it("falls back to the default when the stored display was disconnected", () => {
    // Saved on the secondary monitor, which is no longer attached.
    const stored = { x: -1500, y: 400 };
    const position = resolveOverlayPosition(
      stored,
      [PRIMARY],
      PRIMARY,
      PANEL_WIDTH,
      PANEL_HEIGHT
    );
    expect(position).toEqual(defaultPosition(PRIMARY, PANEL_WIDTH, PANEL_HEIGHT));
  });

  it("restores onto the secondary monitor while it is still attached", () => {
    const stored = { x: -1500, y: 400 };
    const position = resolveOverlayPosition(
      stored,
      [PRIMARY, SECONDARY],
      PRIMARY,
      PANEL_WIDTH,
      PANEL_HEIGHT
    );
    expect(position).toEqual(stored);
  });

  it("pulls a partially off-screen stored position back into view", () => {
    const stored = { x: 1900, y: 1030 };
    const position = resolveOverlayPosition(
      stored,
      [PRIMARY],
      PRIMARY,
      PANEL_WIDTH,
      PANEL_HEIGHT
    );
    expect(position.x).toBe(1920 - 48);
    expect(position.y).toBe(1040 - 48);
  });
});
