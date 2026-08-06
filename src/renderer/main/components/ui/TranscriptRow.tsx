import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { TranscriptRecord } from "../../../../shared/ipc";
import { IconButton } from "./IconButton";
import { Badge } from "./Badge";
import { cn } from "../../lib/cn";

const formatTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

const formatSeconds = (durationMs: number): string =>
  `${(durationMs / 1000).toFixed(1)}s`;

/**
 * One row in the History list. The transcript text is the dominant
 * element; metadata is muted beneath it. A 72px slot on the right holds
 * the copy and delete actions. The slot is reserved (not hover-gated) so
 * the row does not shift when a mouse enters.
 */
export interface TranscriptRowProps {
  readonly record: TranscriptRecord;
  readonly focused: boolean;
  readonly copyArmed: boolean;
  readonly deleteArmed: boolean;
  readonly onCopy: () => void;
  readonly onArmCopy: () => void;
  readonly onArmDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onCancelArmedDelete: () => void;
}

export function TranscriptRow({
  record,
  focused,
  copyArmed,
  deleteArmed,
  onCopy,
  onArmCopy,
  onArmDelete,
  onConfirmDelete,
  onCancelArmedDelete
}: TranscriptRowProps): JSX.Element {
  return (
    <article
      className={cn(
        "group relative flex items-start gap-3 overflow-hidden rounded-md border bg-surface px-4 py-3",
        "transition-colors duration-hover",
        focused
          ? "border-accent bg-surface-hover"
          : "border-border hover:bg-surface-hover"
      )}
    >
      {focused && (
        <span
          className="absolute left-0 top-0 h-full w-[2px] bg-accent"
          aria-hidden="true"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm leading-snug text-text">{record.text}</p>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-text-muted" data-numeric>
          <span>{formatTime(record.createdAtMs)}</span>
          <span aria-hidden="true">·</span>
          <span>{formatSeconds(record.durationMs)}</span>
          {record.engineId !== "mock" && (
            <>
              <span aria-hidden="true">·</span>
              <Badge tone="neutral">{record.engineId}</Badge>
            </>
          )}
          {record.costUsd !== null && record.costUsd > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>${record.costUsd.toFixed(4)}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex w-[72px] shrink-0 items-center justify-end gap-1">
        {copyArmed ? (
          <span className="inline-flex h-7 items-center gap-1 rounded-sm bg-accent-soft px-1.5 text-2xs font-semibold uppercase tracking-wide text-accent-text">
            <Icon icon="ph:check" className="h-3 w-3" aria-hidden="true" />
            Copied
          </span>
        ) : (
          <IconButton
            icon="ph:copy"
            label="Copy transcript"
            size="sm"
            onClick={() => {
              onArmCopy();
              onCopy();
            }}
          />
        )}
        {deleteArmed ? (
          <button
            type="button"
            onClick={onConfirmDelete}
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
            onClick={onArmDelete}
          />
        )}
      </div>
    </article>
  );
}
