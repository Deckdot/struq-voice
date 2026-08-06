import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { MainWindowApi } from "../../../shared/api";
import type { TranscriptRecord } from "../../../shared/ipc";
import { EmptyState, SearchInput, TranscriptRow } from "../components/ui";
import { formatDayHeading } from "../lib/format";

import { useTranslation } from "../lib/useTranslation";

const SEARCH_INPUT_ID = "history-search";

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

const DAY_MS = 86_400_000;

const startOfDay = (epochMs: number): number => {
  const d = new Date(epochMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const groupRecords = (
  records: readonly TranscriptRecord[],
  todayStart: number,
  t: ReturnType<typeof useTranslation>["t"]
): ListEntry[] => {
  const out: ListEntry[] = [];
  let lastDay = -1;
  for (const record of records) {
    const day = startOfDay(record.createdAtMs);
    if (day !== lastDay) {
      const diff = Math.round((todayStart - day) / DAY_MS);
      const label =
        diff === 0
          ? t("history.day.today")
          : diff === 1
            ? t("history.day.yesterday")
            : formatDayHeading(record.createdAtMs);
      out.push({
        kind: "header",
        id: `h-${String(day)}`,
        label
      });
      lastDay = day;
    }
    out.push({ kind: "row", id: `r-${String(record.id)}`, record });
  }
  return out;
};

/**
 * A collapsed row measures ~93px: 24px of vertical padding, two clamped lines
 * at text-sm/leading-snug, a 6px gap, the metadata line, and the 8px gutter on
 * the positioning wrapper. Rows are still measured for real (expanding one
 * changes its height), but an accurate estimate is what stops the total size
 * from drifting under the scrollbar mid-drag.
 */
const ROW_HEIGHT = 93;
const HEADER_HEIGHT = 36;

export function HistoryView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const { t } = useTranslation();
  const [records, setRecords] = useState<readonly TranscriptRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [copyArmed, setCopyArmed] = useState<number | null>(null);
  const [deleteArmed, setDeleteArmed] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  // Stable within a calendar day, so the grouping memo survives every scroll.
  const todayStart = startOfDay(Date.now());
  const entries = useMemo(() => groupRecords(records, todayStart, t), [records, todayStart, t]);

  // One effect owns the record set. The previous split (a load effect keyed on
  // [api] plus a search effect that returned early on an empty query) meant
  // clearing the search left the filtered list on screen.
  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();
    const timer = window.setTimeout(
      () => {
        const request =
          trimmed.length === 0
            ? api.history.list({ limit: 500 })
            : api.history.search({ query: trimmed, limit: 200 });
        void request.then(({ items }) => {
          if (cancelled) return;
          setRecords(items);
          setLoading(false);
        });
      },
      trimmed.length === 0 ? 0 : 250
    );
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

  const getItemKey = useCallback(
    (index: number): string | number => entries[index]?.id ?? index,
    [entries]
  );
  const estimateSize = useCallback(
    (index: number): number => (entries[index]?.kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT),
    [entries]
  );

  const rowVirtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize,
    overscan: 6
  });

  // Find the first row index so key navigation lands on a row, not a header.
  const rowIndices = useMemo(() => {
    const out: number[] = [];
    entries.forEach((entry, index) => {
      if (entry.kind === "row") out.push(index);
    });
    return out;
  }, [entries]);
  const firstRowIndex = rowIndices[0] ?? 0;

  const focusedEntryIndex = Math.min(Math.max(focusedIndex, 0), entries.length - 1);
  const focusedEntry = entries[focusedEntryIndex];
  const focusedRowId = focusedEntry?.kind === "row" ? focusedEntry.record.id : null;

  const handleCopy = useCallback(
    (id: number, text: string): void => {
      api.clipboard.copy(text);
      setCopyArmed(id);
    },
    [api]
  );

  const handleArmDelete = useCallback((id: number): void => {
    setDeleteArmed(id);
  }, []);

  const handleCancelArmedDelete = useCallback((): void => {
    setDeleteArmed(null);
  }, []);

  const handleConfirmDelete = useCallback(
    (id: number): void => {
      void api.history.remove({ id }).then(() => {
        setRecords((current) => current.filter((item) => item.id !== id));
        setDeleteArmed(null);
      });
    },
    [api]
  );

  const handleToggleExpanded = useCallback((id: number): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

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
      handleCopy(focusedEntry.record.id, focusedEntry.record.text);
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      focusedEntry?.kind === "row"
    ) {
      event.preventDefault();
      if (deleteArmed === focusedEntry.record.id) {
        handleConfirmDelete(focusedEntry.record.id);
      } else {
        handleArmDelete(focusedEntry.record.id);
      }
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <div className="flex shrink-0 items-center justify-between gap-4 px-6 pb-3 pt-5">
        <SearchInput
          id={SEARCH_INPUT_ID}
          value={query}
          onChange={setQuery}
          onClear={() => {
            setQuery("");
          }}
          placeholder={t("history.searchPlaceholder")}
          className="w-[280px]"
        />
        {!loading && records.length > 0 && (
          <span className="text-2xs text-text-muted" data-numeric>
            {t("history.count", { count: records.length })}
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4 focus:outline-none"
        onKeyDown={onListKeyDown}
        tabIndex={0}
        role="list"
        aria-label="Transcripts"
      >
        {loading && <p className="px-4 py-6 text-sm text-text-muted">{t("history.loading")}</p>}

        {!loading && records.length === 0 && (
          <EmptyState
            icon="ph:clock-counter-clockwise"
            title={
              query.trim().length > 0
                ? t("history.emptySearch.title")
                : t("history.empty.title")
            }
            body={
              query.trim().length > 0
                ? t("history.emptySearch.body")
                : t("history.empty.body")
            }
          />
        )}

        {!loading && records.length > 0 && (
          <div style={{ height: `${String(rowVirtualizer.getTotalSize())}px`, position: "relative" }}>
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
                      transform: `translateY(${String(virtualRow.start)}px)`
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
                    paddingBottom: "8px"
                  }}
                >
                  <TranscriptRow
                    record={record}
                    focused={record.id === focusedRowId}
                    expanded={expanded.has(record.id)}
                    copyArmed={copyArmed === record.id}
                    deleteArmed={deleteArmed === record.id}
                    onToggleExpanded={handleToggleExpanded}
                    onCopy={handleCopy}
                    onArmDelete={handleArmDelete}
                    onConfirmDelete={handleConfirmDelete}
                    onCancelArmedDelete={handleCancelArmedDelete}
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
