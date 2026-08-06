import type { JSX } from "react";
import { cn } from "../../lib/cn";

/**
 * A small filled dot. Its colour and pulse cadence name the current state
 * of whatever it sits next to: red for an error, green for ready, ember
 * for live capture. Pulse is `motion-safe` so reduced-motion users see a
 * steady dot.
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
  readonly pulse?: boolean;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

const STATE_COLOR: Record<StatusState, string> = {
  idle: "bg-text-muted",
  arming: "bg-ember",
  listening: "bg-ember",
  transcribing: "bg-info",
  delivering: "bg-success",
  error: "bg-danger",
  ready: "bg-success",
  warning: "bg-warning",
  off: "bg-border"
};

const PULSE_STATE: ReadonlySet<StatusState> = new Set<StatusState>([
  "arming",
  "listening",
  "transcribing"
]);

export function StatusDot({ state, pulse, size = "md", className }: StatusDotProps): JSX.Element {
  const sizeClass = size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2";
  const shouldPulse = pulse === true || (pulse === undefined && PULSE_STATE.has(state));
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-pill",
        sizeClass,
        STATE_COLOR[state],
        shouldPulse && "motion-safe:animate-pulse",
        className
      )}
      aria-hidden="true"
    />
  );
}
