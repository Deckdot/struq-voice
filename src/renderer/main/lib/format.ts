/**
 * Display formatters shared by the dashboard and History, so a timestamp
 * reads the same in both places.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * "just now", "4m", "3h", "2d", then a calendar date once relative time
 * stops being the faster read. Deliberately terse: this sits at the end of a
 * row where the transcript is what matters.
 */
export const formatRelativeTime = (epochMs: number, now = Date.now()): string => {
  const elapsed = now - epochMs;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${String(Math.floor(elapsed / MINUTE))}m`;
  if (elapsed < DAY) return `${String(Math.floor(elapsed / HOUR))}h`;
  if (elapsed < 7 * DAY) return `${String(Math.floor(elapsed / DAY))}d`;
  return new Date(epochMs).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** The unabbreviated timestamp, for the title attribute behind the short one. */
export const formatAbsoluteTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

/** Word count for display. Matches the SQL counter in the history store. */
export const countWords = (text: string): number => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
};
