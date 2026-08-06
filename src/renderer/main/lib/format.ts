/**
 * Display formatters shared by the dashboard and History, so a timestamp
 * reads the same in both places.
 *
 * The Intl formatters are built once at module load. toLocaleString builds a
 * fresh formatter on every call, and History formats two timestamps per row
 * on every scroll frame, which made it the single most expensive thing in
 * that list.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const shortDateFormat = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric"
});

const absoluteFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const dayHeadingFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric"
});

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
  return shortDateFormat.format(epochMs);
};

/** The unabbreviated timestamp, for the title attribute behind the short one. */
export const formatAbsoluteTime = (epochMs: number): string => absoluteFormat.format(epochMs);

/** The day separator in History: "Monday, March 3". */
export const formatDayHeading = (epochMs: number): string => dayHeadingFormat.format(epochMs);

/** Word count for display. Matches the SQL counter in the history store. */
export const countWords = (text: string): number => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
};
