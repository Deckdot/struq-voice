import type { JSX } from "react";
import { cn } from "../../lib/cn";

/**
 * A thin progress bar. The track is the sunken surface; the fill is the
 * tone colour. Width animates with the micro easing so the bar never
 * jumps.
 */
export type ProgressTone = "accent" | "ember" | "success" | "info";

export interface ProgressBarProps {
  readonly value: number;
  readonly label?: string;
  readonly tone?: ProgressTone;
  readonly className?: string;
}

const TONE: Record<ProgressTone, string> = {
  accent: "bg-accent-solid",
  ember: "bg-ember",
  success: "bg-success",
  info: "bg-info"
};

export function ProgressBar({ value, label, tone = "accent", className }: ProgressBarProps): JSX.Element {
  const pct = Math.min(1, Math.max(0, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      aria-label={label}
      className={cn("h-1 w-full overflow-hidden rounded-pill bg-bg-sunken", className)}
    >
      <div
        className={cn("h-full rounded-pill transition-[width] duration-control", TONE[tone])}
        style={{ width: `${String(pct)}%` }}
      />
    </div>
  );
}

/**
 * Human-readable byte count. Used wherever a model size or runtime size
 * has to be shown to a person.
 */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i] ?? "B"}`;
};
