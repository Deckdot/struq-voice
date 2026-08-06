import type { JSX } from "react";
import { cn } from "../../lib/cn";

/**
 * A small filled dot. Colour alone names the state of whatever it sits next
 * to: red for an error, green for ready and live capture.
 *
 * It does not pulse. An indicator that breathes forever draws the eye to a
 * thing that is not changing, and it is the loudest generic-web-app tell in
 * a desktop chrome. Live capture already has the overlay waveform, which
 * moves because the audio is actually moving.
 */
export type StatusState =
  | "idle"
  | "arming"
  | "listening"
  | "transcribing"
  | "delivering"
  | "error"
  | "ready"
  | "warning"
  | "off";

export interface StatusDotProps {
  readonly state: StatusState;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

const STATE_COLOR: Record<StatusState, string> = {
  idle: "bg-text-muted",
  arming: "bg-ember",
  listening: "bg-success",
  transcribing: "bg-info",
  delivering: "bg-success",
  error: "bg-danger",
  ready: "bg-success",
  warning: "bg-warning",
  off: "bg-border-strong"
};

export function StatusDot({ state, size = "md", className }: StatusDotProps): JSX.Element {
  const sizeClass = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span className={cn("relative inline-flex shrink-0", sizeClass, className)} aria-hidden="true">
      {state === "listening" && (
        <span className="absolute inset-0 rounded-pill bg-success opacity-40 motion-safe:animate-ping" />
      )}
      <span className={cn("relative h-full w-full rounded-pill", STATE_COLOR[state])} />
    </span>
  );
}
