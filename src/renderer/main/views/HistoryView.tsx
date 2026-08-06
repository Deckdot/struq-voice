import { useEffect, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MainWindowApi } from "../../../shared/api";
import type { TranscriptRecord } from "../../../shared/ipc";
import { EmptyState, SearchInput, TranscriptRow } from "../components/ui";

const SEARCH_INPUT_ID = "history-search";

/**
 * The History view. Every transcript Struq Voice has produced, searched
 * through the keyboard or the search field. Rows are virtualized because
 * a long-running user has thousands; the row's transcript text is the
 * thing the eye should find first, so it is the dominant element, with
 * the date and engine as quiet metadata.
 */

interface GroupHeader {
  readonly kind: "header";
  readonly id: string;
  readonly label: string;
}

interface GroupRow {
  readonly kind: "row";
  readonly id: string;
  readonly record: TranscriptRecord;
}

type ListEntry = GroupHeader | GroupRow;

const startOfDay = (epochMs: number): number => {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const dayLabel = (epochMs: number, now: number): string => {
  const day = startOfDay(epochMs);
  const today = startOfDay(now);
  const diff = Math.round((today - day) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return new Date(epochMs).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });
};

const groupRecords = (records: readonly TranscriptRecord[], now: number): ListEntry[] => {
  const out: ListEntry[] = [];
  let lastDay = -1;
  for (const record of records) {
    const day = startOfDay(record.createdAtMs);
    if (day !== lastDay) {
      out.push({ kind: "header", id: `h-${String(day)}`, label: dayLabel(record.createdAtMs, now) });
      lastDay = day;
    }
    out.push({ kind: "row", id: `r-${String(record.id)}`, record });
  }
  return out;
};

const ROW_HEIGHT = 88;
const HEADER_HEIGHT = 36;

export function HistoryView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [records, setRecords] = useState<readonly TranscriptRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [copyArmed, setCopyArmed] = useState<number | null>(null);
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const toggleExpanded = (id: number): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  };

  const now = Date.now();
  const entries = groupRecords(records, now);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      void api.history.list({ limit: 500 }).then(({ items }) => {
        if (!cancelled) {
          setRecords(items);
          setLoading(false);
        }
      });
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (query.trim().length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api.history.search({ query: query.trim(), limit: 200 }).then(({ items }) => {
        if (!cancelled) setRecords(items);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, api]);

  useEffect(() => {
    if (deleteArmed === null) return;
    const timer = window.setTimeout(() => {
      setDeleteArmed(null);
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [deleteArmed]);

  useEffect(() => {
    if (copyArmed === null) return;
    const timer = window.setTimeout(() => {
      setCopyArmed(null);
    }, 1200);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copyArmed]);

  // Ctrl+F is what every desktop app binds to "find in this list". Escape
  // clears the query rather than only blurring, because a stale filter is the
  // reason a list looks empty.
  useEffect(() => {
    // The React KeyboardEvent is imported above for the list handler, so the
    // DOM one has to be named explicitly here.
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.getElementById(SEARCH_INPUT_ID)?.focus();
        return;
      }
      if (event.key === "Escape" && query.length > 0) {
        event.preventDefault();
        setQuery("");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [query]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => entries[index]?.id ?? index,
    estimateSize: (index) => (entries[index]?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
    measureElement: (element) => (element as HTMLElement).offsetHeight,
    overscan: 12
  });

  // Find the first row index so key navigation lands on a row, not a header.
  const rowIndices = entries
    .map((entry, index) => (entry.kind === "row" ? index : -1))
    .filter((value) => value !== -1);
  const firstRowIndex = rowIndices[0] ?? 0;

  const focusedEntryIndex = Math.min(Math.max(focusedIndex, 0), entries.length - 1);
  const focusedEntry = entries[focusedEntryIndex];
  const focusedRowId = focusedEntry?.kind === "row" ? focusedEntry.record.id : null;

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (rowIndices.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = rowIndices.find((index) => index > focusedEntryIndex) ?? firstRowIndex;
      setFocusedIndex(next);
      rowVirtualizer.scrollToIndex(next, { align: "auto" });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const previous = [...rowIndices].reverse().find((index) => index < focusedEntryIndex);
      setFocusedIndex(previous ?? firstRowIndex);
      rowVirtualizer.scrollToIndex(previous ?? firstRowIndex, { align: "auto" });
    } else if (event.key === "Enter" && focusedEntry?.kind === "row") {
      event.preventDefault();
      api.clipboard.copy(focusedEntry.record.text);
      setCopyArmed(focusedEntry.record.id);
    } else if ((event.key === "Delete" || event.key === "Backspace") && focusedEntry?.kind === "row") {
      event.preventDefault();
      if (deleteArmed === focusedEntry.record.id) {
        void api.history.remove({ id: focusedEntry.record.id }).then(() => {
          setRecords((current) => current.filter((item) => item.id !== focusedEntry.record.id));
          setDeleteArmed(null);
        });
      } else {
        setDeleteArmed(focusedEntry.record.id);
      }
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex shrink-0 items-center justify-end px-6 pb-2 pt-4">
        <SearchInput
          id={SEARCH_INPUT_ID}
          value={query}
          onChange={setQuery}
          onClear={() => {
            setQuery("");
          }}
          placeholder="Search transcripts"
          className="w-[280px]"
        />
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4 focus:outline-none"
        onKeyDown={onListKeyDown}
        tabIndex={0}
        role="list"
        aria-label="Transcripts"
      >
        {loading && (
          <p className="px-4 py-6 text-sm text-text-muted">Loading your transcripts...</p>
        )}

        {!loading && records.length === 0 && (
          <EmptyState
            icon="ph:clock-counter-clockwise"
            title={
              query.trim().length > 0
                ? "Nothing matches that search."
                : "No transcripts yet."
            }
            body={
              query.trim().length > 0
                ? "Try a different word, or clear the search to see everything."
                : "Hold your key, say a sentence, release. It will land here."
            }
          />
        )}

        {!loading && records.length > 0 && (
          <div
            style={{ height: `${String(rowVirtualizer.getTotalSize())}px`, position: "relative" }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = entries[virtualRow.index];
              if (entry === undefined) return null;
              if (entry.kind === "header") {
                return (
                  <div
                    key={entry.id}
                    style={{
                      position: "absolute",
                      top: "0",
                      left: "0",
                      width: "100%",
                      height: `${String(virtualRow.size)}px`,
                      transform: `translateY(${String(virtualRow.start)}px)`,
                      willChange: "transform"
                    }}
                    className="flex items-center px-1"
                  >
                    <span className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
                      {entry.label}
                    </span>
                  </div>
                );
              }
              const record = entry.record;
              return (
                <div
                  key={entry.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: "100%",
                    transform: `translateY(${String(virtualRow.start)}px)`,
                    paddingBottom: "8px",
                    willChange: "transform"
                  }}
                >
                  <TranscriptRow
                    record={record}
                    focused={record.id === focusedRowId}
                    expanded={expanded.has(record.id)}
                    onToggleExpanded={() => {
                      toggleExpanded(record.id);
                    }}
                    copyArmed={copyArmed === record.id}
                    deleteArmed={deleteArmed === record.id}
                    onCopy={() => {
                      api.clipboard.copy(record.text);
                    }}
                    onArmCopy={() => {
                      setCopyArmed(record.id);
                    }}
                    onArmDelete={() => {
                      setDeleteArmed(record.id);
                    }}
                    onConfirmDelete={() => {
                      void api.history.remove({ id: record.id }).then(() => {
                        setRecords((current) => current.filter((item) => item.id !== record.id));
                        setDeleteArmed(null);
                      });
                    }}
                    onCancelArmedDelete={() => {
                      setDeleteArmed(null);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
