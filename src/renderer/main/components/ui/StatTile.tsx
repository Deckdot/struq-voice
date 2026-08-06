import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { HistoryStatsDay } from "../../../../shared/ipc";
import { cn } from "../../lib/cn";

/**
 * One number worth knowing. The value is the loudest thing in the tile and
 * is tabular, so a count ticking from 999 to 1000 does not shift the row.
 * The label is small and quiet: you read the number first and the label only
 * if the number surprised you.
 */
export interface StatTileProps {
  readonly icon: string;
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly className?: string;
}

export function StatTile({ icon, label, value, hint, className }: StatTileProps): JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border border-border bg-surface px-4 py-3",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-text-muted">
        <Icon icon={icon} className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="text-2xs font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <span
        className="font-display text-2xl font-semibold leading-tight tracking-tight text-text"
        data-numeric
      >
        {value}
      </span>
      {hint !== undefined && <span className="text-2xs text-text-muted">{hint}</span>}
    </div>
  );
}

/**
 * Fourteen days of dictation as bars. Heights are relative to the busiest
 * day in the window, so the shape reads even when the absolute numbers are
 * small. An empty day keeps its slot as a hairline rather than vanishing,
 * which is the difference between "quiet Tuesday" and "no Tuesday".
 */
export function Sparkline({
  days,
  className
}: {
  readonly days: readonly HistoryStatsDay[];
  readonly className?: string;
}): JSX.Element {
  const peak = days.reduce((max, day) => Math.max(max, day.words), 0);
  return (
    <div className={cn("flex h-8 items-end gap-[3px]", className)} aria-hidden="true">
      {days.map((day) => {
        const ratio = peak > 0 ? day.words / peak : 0;
        return (
          <div
            key={day.dayStartMs}
            className={cn(
              "min-h-[2px] flex-1 rounded-t-sm",
              day.words > 0 ? "bg-accent" : "bg-border"
            )}
            style={{ height: `${String(Math.max(6, Math.round(ratio * 100)))}%` }}
          />
        );
      })}
    </div>
  );
}
