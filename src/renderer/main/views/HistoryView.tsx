import type { JSX } from "react";

/**
 * History view. The full reader (virtualised list, FTS search, copy and
 * dictionary actions) lands in a later slice; this stub establishes the
 * route and its empty state.
 */
export function HistoryView(): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8">
      <h1 className="font-serif text-xl tracking-tight text-text">History</h1>
      <p className="max-w-md text-center text-sm text-text-muted">
        Every transcript you have dictated, searchable. Coming next.
      </p>
    </div>
  );
}
