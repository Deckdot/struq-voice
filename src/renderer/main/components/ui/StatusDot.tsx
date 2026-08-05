import type { JSX } from "react";
import type { CapturePhase } from "../../../../shared/capture";
import { cn } from "../../lib/cn";

/**
 * The capture phase as a single dot, driven by the state tokens so every
 * surface that shows capture state agrees on the colour. Arming borrows the
 * listening tone: the machine is already committed to a capture.
 */
const PHASE_TONE: Record<CapturePhase, string> = {
  idle: "bg-state-idle",
  arming: "bg-state-listening",
  listening: "bg-state-listening",
  transcribing: "bg-state-transcribing",
  delivering: "bg-state-delivered",
  error: "bg-state-error"
};

export interface StatusDotProps {
  readonly phase: CapturePhase;
  readonly className?: string;
}

export function StatusDot({ phase, className }: StatusDotProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PHASE_TONE[phase], className)}
    />
  );
}
