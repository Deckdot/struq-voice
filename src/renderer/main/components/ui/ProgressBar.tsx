import type { JSX } from "react";
import { cn } from "../../lib/cn";

/**
 * Determinate progress with the numbers attached. A download reports what it
 * has and what it is waiting for; a bare spinner tells the user nothing they
 * did not already know. Width is the one animated property here, and it is
 * driven by real bytes rather than a timer.
 */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

export interface ProgressBarProps {
  readonly receivedBytes: number;
  readonly totalBytes: number;
  /** Bytes per second; omitted until two progress events have landed. */
  readonly bytesPerSecond?: number | null;
  readonly label?: string;
  readonly className?: string;
}

export function ProgressBar({
  receivedBytes,
  totalBytes,
  bytesPerSecond,
  label,
  className
}: ProgressBarProps): JSX.Element {
  const fraction = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0;
  const percent = Math.round(fraction * 100);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-bg-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={label ?? "Download progress"}
      >
        <span
          className="h-full rounded-full bg-accent transition-[width] duration-normal"
          style={{ width: `${String(percent)}%` }}
        />
      </div>
      <p className="flex items-center justify-between text-xs text-text-muted" data-numeric>
        <span>
          {formatBytes(receivedBytes)} of {formatBytes(totalBytes)}
        </span>
        <span>
          {String(percent)}%
          {bytesPerSecond !== undefined && bytesPerSecond !== null && bytesPerSecond > 0
            ? ` at ${formatBytes(bytesPerSecond)}/s`
            : ""}
        </span>
      </p>
    </div>
  );
}
