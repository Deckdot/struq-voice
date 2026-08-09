import { memo, useMemo, useRef } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { TranscriptRecord } from "../../../../shared/ipc";
import { IconButton } from "./IconButton";
import { cn } from "../../lib/cn";
import { countWords, formatAbsoluteTime, formatRelativeTime } from "../../lib/format";

const formatSeconds = (durationMs: number): string => `${(durationMs / 1000).toFixed(1)}s`;

/**
 * A pointer that moved less than this between mousedown and mouseup counts as
 * a click. A text drag moves further, and its trailing click must not toggle
 * the row, because the rule popover's autofocus can collapse the document
 * selection before that click runs, which would defeat a selection check.
 */
const DRAG_THRESHOLD_PX = 4;

/**
 * One row in the History list. The transcript text is the dominant element;
 * metadata is muted beneath it. A 72px slot on the right holds the copy and
 * delete actions. The slot is reserved (not hover-gated) so the row does not
 * shift when a mouse enters.
 *
 * Collapsed rows clamp to two lines, which for a long dictation hides most of
 * what was said. Clicking the text expands the row in place rather than
 * opening a dialog: reading a transcript should not cost a context switch.
 */
export interface TranscriptRowProps {
  readonly record: TranscriptRecord;
  readonly focused: boolean;
  readonly expanded: boolean;
  readonly copyArmed: boolean;
  readonly deleteArmed: boolean;
  readonly onToggleExpanded: (id: number) => void;
  readonly onCopy: (id: number, text: string) => void;
  readonly onArmDelete: (id: number) => void;
  readonly onConfirmDelete: (id: number) => void;
  readonly onCancelArmedDelete: () => void;
}

export const TranscriptRow = memo(function TranscriptRow({
  record,
  focused,
  expanded,
  copyArmed,
  deleteArmed,
  onToggleExpanded,
  onCopy,
  onArmDelete,
  onConfirmDelete,
  onCancelArmedDelete
}: TranscriptRowProps): JSX.Element {
  const { words, relative, absolute, iso } = useMemo(
    () => ({
      words: countWords(record.text),
      relative: formatRelativeTime(record.createdAtMs),
      absolute: formatAbsoluteTime(record.createdAtMs),
      iso: new Date(record.createdAtMs).toISOString()
    }),
    [record]
  );
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);

  return (
    <article
      data-record-id={record.id}
      className={cn(
        "group relative flex items-start gap-3 overflow-hidden rounded-md border bg-surface px-4 py-3",
        "transition-colors duration-hover",
        focused ? "border-accent bg-surface-hover" : "border-border hover:bg-surface-hover"
      )}
    >
      {focused && (
        <span className="absolute left-0 top-0 h-full w-[2px] bg-accent" aria-hidden="true" />
      )}
      <button
        type="button"
        onMouseDown={(event) => {
          pointerStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onClick={(event) => {
          // A click that is really a finished drag-select must not collapse
          // the row: the selection check below can be defeated by the rule
          // popover's autofocus collapsing the selection first, so the drag
          // distance is the load-bearing guard.
          const start = pointerStartRef.current;
          pointerStartRef.current = null;
          const dragged =
            start !== null &&
            Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_THRESHOLD_PX;
          if (dragged) return;
          const selection = window.getSelection();
          if (selection !== null && selection.toString().trim().length > 0) return;
          onToggleExpanded(record.id);
        }}
        aria-expanded={expanded}
        className="min-w-0 flex-1 cursor-pointer text-start"
      >
        <p
          className={cn(
            "text-sm leading-snug text-text",
            expanded ? "whitespace-pre-wrap" : "line-clamp-2"
          )}
          data-selectable={expanded ? "" : undefined}
          data-transcript-text=""
        >
          {record.text}
        </p>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted" data-numeric>
          <time dateTime={iso} title={absolute}>
            {relative}
          </time>
          <span aria-hidden="true">·</span>
          <span>
            {String(words)} word{words === 1 ? "" : "s"}
          </span>
          <span aria-hidden="true">·</span>
          <span>{formatSeconds(record.durationMs)}</span>
          {record.costUsd !== null && record.costUsd > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>${record.costUsd.toFixed(4)}</span>
            </>
          )}
        </div>
      </button>
      <div className="flex w-[72px] shrink-0 items-center justify-end gap-1">
        {copyArmed ? (
          <span className="inline-flex h-7 w-7 items-center justify-center text-success">
            <Icon icon="ph:check" className="h-4 w-4" aria-hidden="true" />
          </span>
        ) : (
          <IconButton
            icon="ph:copy"
            label="Copy transcript"
            size="sm"
            onClick={() => {
              onCopy(record.id, record.text);
            }}
          />
        )}
        {deleteArmed ? (
          <button
            type="button"
            onClick={() => {
              onConfirmDelete(record.id);
            }}
            onBlur={onCancelArmedDelete}
            className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-danger bg-danger px-2 text-2xs font-semibold uppercase tracking-wide text-text-inverse"
            aria-label="Confirm delete"
          >
            <Icon icon="ph:trash" className="h-3 w-3" aria-hidden="true" />
            Delete?
          </button>
        ) : (
          <IconButton
            icon="ph:trash"
            label="Delete transcript"
            size="sm"
            variant="danger"
            onClick={() => {
              onArmDelete(record.id);
            }}
          />
        )}
      </div>
    </article>
  );
});
