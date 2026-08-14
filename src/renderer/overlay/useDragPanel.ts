/**
 * Dragging for the capture panel.
 *
 * The overlay window is `focusable: false` so that a synthesised Ctrl+V lands
 * in the app the user was actually typing in. That is load-bearing for the
 * whole product, and it costs us both native dragging and
 * -webkit-app-region: neither works on a window that cannot be activated.
 *
 * So the drag is done by hand. The renderer tracks the pointer in screen
 * coordinates and asks main to reposition the window, throttled to one call
 * per animation frame: `setPosition` per pointermove would flood IPC and
 * visibly lag the panel behind the cursor.
 */

import { useCallback, useEffect, useRef } from "react";

export interface DragPanelHandlers {
  readonly onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
}

export const useDragPanel = (move: (x: number, y: number) => void): DragPanelHandlers => {
  // The offset from the window's top-left to the grab point, so the panel
  // keeps its position under the cursor rather than snapping its corner there.
  const grabOffset = useRef<{ x: number; y: number } | null>(null);
  const pending = useRef<{ x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  // The window listeners attached for an active drag. An unmount mid-drag
  // must tear them down or they outlive the panel until the next pointerup.
  const dragHandlers = useRef<{
    move: (event: PointerEvent) => void;
    up: () => void;
  } | null>(null);

  const flush = useCallback((): void => {
    frame.current = null;
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    move(next.x, next.y);
  }, [move]);

  const queueMove = useCallback(
    (x: number, y: number): void => {
      pending.current = { x, y };
      frame.current ??= requestAnimationFrame(flush);
    },
    [flush]
  );

  const clearDragListeners = useCallback((): void => {
    const handlers = dragHandlers.current;
    dragHandlers.current = null;
    if (handlers === null) return;
    window.removeEventListener("pointermove", handlers.move);
    window.removeEventListener("pointerup", handlers.up);
    window.removeEventListener("pointercancel", handlers.up);
  }, []);

  useEffect(() => {
    return () => {
      clearDragListeners();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      // An unmount mid-drag (the capture ended while the pointer was still
      // down) must land the last queued position: without this the panel
      // settles a frame behind the drop and that final spot is never saved.
      const pendingMove = pending.current;
      pending.current = null;
      if (pendingMove !== null) {
        move(pendingMove.x, pendingMove.y);
      }
    };
  }, [clearDragListeners, move]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>): void => {
      // Left button only, and never on an interactive child.
      if (event.button !== 0) return;
      const target = event.target as HTMLElement;
      if (target.closest("[data-no-drag]") !== null) return;

      event.preventDefault();
      const element = event.currentTarget;
      element.setPointerCapture(event.pointerId);

      // screenX/screenY are already in the desktop coordinate space main needs.
      // Deriving the window origin from the grab point keeps the maths correct
      // regardless of where inside the handle the drag started.
      grabOffset.current = {
        x: event.screenX - window.screenX,
        y: event.screenY - window.screenY
      };

      const onPointerMove = (moveEvent: PointerEvent): void => {
        const offset = grabOffset.current;
        if (offset === null) return;
        queueMove(moveEvent.screenX - offset.x, moveEvent.screenY - offset.y);
      };

      const onPointerUp = (): void => {
        grabOffset.current = null;
        // Land the final position even if the last move is still queued, so
        // the panel never settles a frame behind where it was dropped.
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
          frame.current = null;
        }
        flush();
        if (element.hasPointerCapture(event.pointerId)) {
          element.releasePointerCapture(event.pointerId);
        }
        clearDragListeners();
      };

      dragHandlers.current = { move: onPointerMove, up: onPointerUp };
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [flush, queueMove, clearDragListeners]
  );

  return { onPointerDown };
};
