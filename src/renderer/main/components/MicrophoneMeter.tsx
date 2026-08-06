import type { JSX } from "react";
import { cn } from "../lib/cn";

export interface MicrophoneMeterProps {
  readonly level: number;
  readonly label?: string;
  readonly className?: string;
}

/** Shared warm-microphone feedback used anywhere the user needs to verify input. */
export function MicrophoneMeter({
  level,
  label = "Microphone level",
  className
}: MicrophoneMeterProps): JSX.Element {
  const meterWidth = Math.min(100, Math.max(0, Math.round(level * 100)));

  return (
    <div
      className={cn("h-1 w-full overflow-hidden rounded-pill bg-bg-sunken", className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={meterWidth}
      aria-label={label}
    >
      <div
        className="h-full rounded-pill bg-accent transition-[width] duration-75"
        style={{ width: `${String(meterWidth)}%` }}
      />
    </div>
  );
}
