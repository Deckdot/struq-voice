import type { JSX } from "react";
import { cn } from "../../lib/cn";
import { RecordingBall } from "../../../shared/RecordingBall";

/**
 * A small filled dot. Colour alone names the state of whatever it sits next
 * to: red for an error, green for ready and live capture.
 *
 * Static states do not pulse. Listening replaces the dot with the supplied
 * bouncing-ball mark because that motion represents a capture in progress.
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
  listening: "bg-capture",
  transcribing: "bg-info",
  delivering: "bg-capture",
  error: "bg-danger",
  ready: "bg-success",
  warning: "bg-warning",
  off: "bg-border-strong"
};

export function StatusDot({ state, size = "md", className }: StatusDotProps): JSX.Element {
  if (state === "listening") {
    return (
      <RecordingBall
        className={cn(size === "sm" ? "h-3 w-3" : "h-4 w-4", className)}
      />
    );
  }

  const sizeClass = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  return (
    <span
      className={cn("inline-flex shrink-0 rounded-pill", sizeClass, STATE_COLOR[state], className)}
      aria-hidden="true"
    />
  );
}
