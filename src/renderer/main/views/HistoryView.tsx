import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX, KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion, useReducedMotion } from "motion/react";
import type { MainWindowApi } from "../../../shared/api";
import { normalizeRuleFrom } from "../../../shared/dictionary";
import type { TranscriptRecord } from "../../../shared/ipc";
import { RuleFromSelection } from "../components/RuleFromSelection";
import { Badge, EmptyState, SearchInput, TranscriptRow } from "../components/ui";
import { formatDayHeading } from "../lib/format";

import { useTranslation } from "../lib/useTranslation";
import { useMainStore } from "../store/use-main-store";

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

/**
 * True when a node sits inside a transcript text element. Selections whose
 * ends bleed into metadata or other rows must not become rule candidates.
 */
const insideTranscriptText = (node: Node | null): boolean => {
  if (node === null) return false;
  const element =
    node.nodeType === Node.TEXT_NODE
      ? node.parentElement
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : null;
  return element !== null && element.closest("[data-transcript-text]") !== null;
};

/**
 * Turn the current document selection into a rule candidate when both ends
 * sit inside transcript text. Collapsed selections and anything else yield
 * null. When a target node is given (right-click), it must also fall inside
 * the selection range, so a right-click elsewhere cannot reopen the popover.
 * The record id lets the caller re-expand the owning row: the popover's
 * autofocus can collapse the selection, and a double-click's first click
 * collapses the row before the word is even selected.
 */
const readSelectionCandidate = (
  target?: EventTarget | null
): {
  readonly text: string;
  readonly recordId: number;
  readonly x: number;
  readonly y: number;
} | null => {
  const selection = window.getSelection();
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!insideTranscriptText(range.startContainer) || !insideTranscriptText(range.endContainer)) {
    return null;
  }
  if (target !== undefined && (!(target instanceof Node) || !range.intersectsNode(target))) {
    return null;
  }
  const rowElement = range.startContainer.parentElement?.closest("[data-record-id]");
  const recordId = Number(rowElement?.getAttribute("data-record-id") ?? NaN);
  if (!Number.isFinite(recordId)) return null;
  const normalized = normalizeRuleFrom(selection.toString());
  if (normalized === null) return null;
  const rect = range.getBoundingClientRect();
  return { text: normalized, recordId, x: rect.left, y: rect.bottom };
};

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
  const [resultRevision, setResultRevision] = useState(0);
  const [searching, setSearching] = useState(false);
  const [ruleCandidate, setRuleCandidate] = useState<{
    readonly text: string;
    readonly recordId: number;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const pendingFocusRef = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
  const historySearch = useMainStore((state) => state.historySearch);

  // Stable within a calendar day, so the grouping memo survives every scroll.
  const todayStart = startOfDay(Date.now());
  const entries = useMemo(() => groupRecords(records, todayStart, t), [records, todayStart, t]);

  // One effect owns the record set. The previous split (a load effect keyed on
  // [api] plus a search effect that returned early on an empty query) meant
  // clearing the search left the filtered list on screen.
  useEffect(() => {
    let cancelled = false;
    const trimmed = query.trim();
    setSearching(trimmed.length > 0);
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
          setSearching(false);
          setResultRevision((current) => current + 1);
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

  // The command palette hands over a search intent: apply the query and, when
  // a specific transcript was picked, remember its id until the search lands.
  // Reactive rather than mount-only, so a pick made while already on History
  // is consumed immediately instead of replaying on the next mount.
  useEffect(() => {
    if (historySearch === null) return;
    setQuery(historySearch.query);
    document.getElementById(SEARCH_INPUT_ID)?.focus();
    if (historySearch.focusId !== null) pendingFocusRef.current = historySearch.focusId;
    useMainStore.getState().consumeHistorySearch();
  }, [historySearch]);

  // Escape clears the query rather than only blurring, because a stale filter
  // is the reason a list looks empty. Ctrl+F belongs to the global search.
  useEffect(() => {
    // The React KeyboardEvent is imported above for the list handler, so the
    // DOM one has to be named explicitly here.
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && query.length > 0) {
        const target = event.target;
        if (target instanceof Element) {
          const insideTransientSurface =
            target.closest("[cmdk-root]") !== null || target.closest("[data-rule-popover]") !== null;
          if (insideTransientSurface) return;
        }
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

  /**
   * Open the rule popover and guarantee the owning row stays expanded.
   * Without the second half, the popover's autofocus collapsing the document
   * selection lets the drag's trailing click toggle the row shut underneath
   * it, and a double-click's first click collapses before the word is even
   * selected.
   */
  const openRulePopover = (candidate: {
    readonly text: string;
    readonly recordId: number;
    readonly x: number;
    readonly y: number;
  }): void => {
    setRuleCandidate(candidate);
    setExpanded((current) => {
      if (current.has(candidate.recordId)) return current;
      const next = new Set(current);
      next.add(candidate.recordId);
      return next;
    });
  };

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

  // Once the searched records are loaded, jump to the palette-picked
  // transcript: expand it, focus its row and centre it in the viewport.
  useEffect(() => {
    const focusId = pendingFocusRef.current;
    if (focusId === null) return;
    if (loading) return;
    const index = entries.findIndex(
      (entry) => entry.kind === "row" && entry.record.id === focusId
    );
    if (index >= 0) {
      setExpanded((current) => {
        if (current.has(focusId)) return current;
        const next = new Set(current);
        next.add(focusId);
        return next;
      });
      setFocusedIndex(index);
      rowVirtualizer.scrollToIndex(index, { align: "center" });
    }
    pendingFocusRef.current = null;
  }, [records, entries, loading, rowVirtualizer]);

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
      <div className="flex shrink-0 items-center gap-3 px-6 pb-3 pt-5">
        <SearchInput
          id={SEARCH_INPUT_ID}
          value={query}
          onChange={setQuery}
          onClear={() => {
            setQuery("");
          }}
          placeholder={t("history.searchPlaceholder")}
          clearLabel={t("search.clear")}
          className="w-[280px]"
          onKeyDown={(event) => {
            if (event.key === "Enter" && query.trim().length > 0) {
              event.preventDefault();
              rowVirtualizer.scrollToIndex(firstRowIndex, { align: "auto" });
              setFocusedIndex(firstRowIndex);
              scrollRef.current?.focus();
            }
          }}
        />
        {!loading && records.length > 0 && (
          <Badge tone="neutral" className="h-7 whitespace-nowrap font-normal tabular-nums">
            {t("history.count", { count: records.length })}
          </Badge>
        )}
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-4 focus:outline-none"
        onKeyDown={onListKeyDown}
        tabIndex={0}
        role="list"
        aria-label="Transcripts"
        aria-busy={searching}
        onMouseUp={(event) => {
          if (event.button !== 0) return;
          const candidate = readSelectionCandidate();
          if (candidate !== null) openRulePopover(candidate);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          const candidate = readSelectionCandidate(event.target);
          if (candidate !== null) openRulePopover(candidate);
        }}
        onScroll={() => {
          setRuleCandidate(null);
        }}
      >
        {loading && <p className="px-4 py-6 text-sm text-text-muted">{t("history.loading")}</p>}

        {!loading && records.length === 0 && (
          <motion.div
            key={`empty-${String(resultRevision)}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
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
          </motion.div>
        )}

        {!loading && records.length > 0 && (
          <motion.div
            key={resultRevision}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0.6, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
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
          </motion.div>
        )}
      </div>

      {ruleCandidate !== null && (
        <RuleFromSelection
          text={ruleCandidate.text}
          anchorX={ruleCandidate.x}
          anchorY={ruleCandidate.y}
          onClose={() => {
            setRuleCandidate(null);
          }}
        />
      )}
    </div>
  );
}
