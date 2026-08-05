import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Copy, Trash2, FileText, Sparkles } from "lucide-react";
import type { MainWindowApi } from "../../../shared/api";
import type { TranscriptRecord } from "../../../shared/ipc";

/**
 * The History reader. Every transcript you have dictated, searchable through
 * FTS5. The transcript itself is set in the serif at reading size: a
 * dictation app's output is writing and should look like it. Rows virtualize
 * so thousands of transcripts stay smooth.
 */

const formatTime = (epochMs: number): string =>
  new Date(epochMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });

const formatSeconds = (durationMs: number): string =>
  `${(durationMs / 1000).toFixed(1)}s`;

export function HistoryView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [records, setRecords] = useState<readonly TranscriptRecord[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

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
    const timer = setTimeout(() => {
      void api.history.search({ query: query.trim(), limit: 200 }).then(({ items }) => {
        if (!cancelled) setRecords(items);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, api]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 8
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-5">
        <h1 className="font-serif text-2xl tracking-tight text-text">History</h1>
        <div className="mt-3 flex max-w-md items-center gap-2">
          <Search className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search transcripts..."
            className="w-full rounded-md border border-border bg-bg-sunken px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-border-focus focus:outline-none"
          />
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading && <p className="text-sm text-text-muted">Loading...</p>}

        {!loading && records.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <FileText className="h-8 w-8 text-text-muted" aria-hidden="true" />
            <p className="text-base text-text">
              {query.trim().length > 0 ? "Nothing matches that search." : "No transcripts yet."}
            </p>
            <p className="max-w-sm text-sm text-text-muted">
              {query.trim().length > 0
                ? "Try a different word or clear the search."
                : "Hold Ctrl+Space anywhere, speak, and release. It will land here."}
            </p>
          </div>
        )}

        {!loading && records.length > 0 && (
          <div
            style={{ height: `${String(rowVirtualizer.getTotalSize())}px`, position: "relative" }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const record = records[virtualRow.index];
              if (record === undefined) return null;
              return (
                <article
                  key={record.id}
                  style={{
                    position: "absolute",
                    top: "0",
                    left: "0",
                    width: "100%",
                    height: `${String(virtualRow.size)}px`,
                    transform: `translateY(${String(virtualRow.start)}px)`,
                    padding: "0 0 8px 0"
                  }}
                  className="group"
                >
                  <div className="h-full overflow-hidden rounded-lg border border-border bg-surface p-4 transition-colors duration-fast hover:bg-surface-hover">
                    <div className="flex items-start justify-between gap-4">
                      <p className="min-w-0 font-serif text-lg leading-prose text-text">
                        {record.text}
                      </p>
                      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity duration-fast group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label="Copy transcript"
                          title="Copy"
                          onClick={() => {
                            api.clipboard.copy(record.text);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-surface-active hover:text-text"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Add to dictionary"
                          title="Add to dictionary"
                          onClick={() => {
                            api.clipboard.copy(record.text);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-accent-soft hover:text-accent-text"
                        >
                          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label="Delete transcript"
                          title="Delete"
                          onClick={() => {
                            void api.history.remove({ id: record.id }).then(() => {
                              setRecords((current) =>
                                current.filter((item) => item.id !== record.id),
                              );
                            });
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors duration-fast hover:bg-danger-soft hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-xs text-text-muted" data-numeric>
                      <span>{formatTime(record.createdAtMs)}</span>
                      <span>&middot;</span>
                      <span>{formatSeconds(record.durationMs)}</span>
                      {record.costUsd !== null && record.costUsd > 0 && (
                        <>
                          <span>&middot;</span>
                          <span>${record.costUsd.toFixed(4)}</span>
                        </>
                      )}
                      {record.engineId !== "mock" && (
                        <>
                          <span>&middot;</span>
                          <span>{record.engineId}</span>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
