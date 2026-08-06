import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import type { DictionaryRule } from "../../../shared/dictionary";
import { applyDictionary, countRuleHits, findRuleMatches } from "../../../shared/dictionary";
import type { Settings } from "../../../shared/settings";
import { DEFAULT_SETTINGS } from "../../../shared/settings";
import { PageBody } from "../components/PageHeader";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  IconButton,
  InlineError,
  SearchInput,
  Select,
  Switch,
  TextInput
} from "../components/ui";

const SEARCH_INPUT_ID = "dictionary-search";

interface Draft {
  readonly from: string;
  readonly to: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
}

const EMPTY_DRAFT: Draft = { from: "", to: "", matchCase: false, wholeWord: true };

const DEFAULT_SAMPLE =
  "Type a sentence here to see which rules fire before you rely on them.";

const STARTER_SUGGESTIONS: readonly { from: string; to: string }[] = [
  { from: "struck", to: "Struq" },
  { from: "get hub", to: "GitHub" },
  { from: "post gress", to: "PostgreSQL" }
];

export function DictionaryView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"recent" | "alphabetical">("recent");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteArmedFrom, setDeleteArmedFrom] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const fromInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.settings.get().then(({ settings: loaded }) => {
      setSettings(loaded);
    });
    return api.settings.onChange(setSettings);
  }, [api]);

  useEffect(() => {
    if (deleteArmedFrom === null) return;
    const timer = window.setTimeout(() => {
      setDeleteArmedFrom(null);
    }, 3000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [deleteArmedFrom]);

  useEffect(() => {
    if (statusMessage === null) return;
    const timer = window.setTimeout(() => {
      setStatusMessage(null);
    }, 4000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [statusMessage]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.getElementById(SEARCH_INPUT_ID)?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (editingFrom !== null) {
          setEditingFrom(null);
          setDraft(EMPTY_DRAFT);
        } else if (query.length > 0) {
          event.preventDefault();
          setQuery("");
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [query, editingFrom]);

  const dictionary: readonly DictionaryRule[] = settings.post.dictionary;

  const writeDictionary = useCallback(
    (next: readonly DictionaryRule[]): void => {
      void api.settings
        .update({ post: { ...settings.post, dictionary: [...next] } })
        .then(({ settings: updated }) => {
          setSettings(updated);
        });
    },
    [api, settings.post]
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered =
      needle.length === 0
        ? dictionary
        : dictionary.filter(
            (entry) =>
              entry.from.toLowerCase().includes(needle) ||
              entry.to.toLowerCase().includes(needle)
          );
    return sort === "alphabetical"
      ? [...filtered].sort((a, b) => a.from.localeCompare(b.from))
      : [...filtered].reverse();
  }, [dictionary, query, sort]);

  const preview = useMemo(() => applyDictionary(sample, dictionary), [sample, dictionary]);
  const hits = useMemo(() => countRuleHits(sample, dictionary), [sample, dictionary]);
  const firingCount = useMemo(
    () => [...hits.values()].filter((count) => count > 0).length,
    [hits]
  );

  const checkDuplicate = (from: string, ignoreFrom: string | null = null): boolean => {
    const normalized = from.trim().toLowerCase();
    return dictionary.some(
      (entry) =>
        entry.from.toLowerCase() === normalized &&
        (ignoreFrom === null || entry.from.toLowerCase() !== ignoreFrom.toLowerCase())
    );
  };

  const handleAddOrUpdateRule = (): void => {
    const trimmedFrom = draft.from.trim();
    if (trimmedFrom.length === 0) {
      setError("Please enter the word or phrase to replace.");
      return;
    }
    if (checkDuplicate(trimmedFrom, editingFrom)) {
      setError(`You already have a rule for "${trimmedFrom}".`);
      return;
    }
    setError(null);

    if (editingFrom !== null) {
      const updated = dictionary.map((entry) =>
        entry.from === editingFrom
          ? {
              from: trimmedFrom,
              to: draft.to,
              matchCase: draft.matchCase,
              wholeWord: draft.wholeWord,
              enabled: entry.enabled
            }
          : entry
      );
      writeDictionary(updated);
      setEditingFrom(null);
    } else {
      const nextRule: DictionaryRule = {
        from: trimmedFrom,
        to: draft.to,
        matchCase: draft.matchCase,
        wholeWord: draft.wholeWord,
        enabled: true
      };
      writeDictionary([...dictionary, nextRule]);
    }
    setDraft(EMPTY_DRAFT);
    fromInputRef.current?.focus();
  };

  const handleStartEdit = (rule: DictionaryRule): void => {
    setEditingFrom(rule.from);
    setDraft({
      from: rule.from,
      to: rule.to,
      matchCase: rule.matchCase,
      wholeWord: rule.wholeWord
    });
    setError(null);
    fromInputRef.current?.focus();
  };

  const handleCancelEdit = (): void => {
    setEditingFrom(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  };

  const handleToggleEnabled = (from: string): void => {
    const next = dictionary.map((entry) =>
      entry.from === from ? { ...entry, enabled: !entry.enabled } : entry
    );
    writeDictionary(next);
  };

  const handleRemoveRule = (from: string): void => {
    const next = dictionary.filter((entry) => entry.from !== from);
    writeDictionary(next);
    setDeleteArmedFrom(null);
  };

  const handleClearAll = (): void => {
    writeDictionary([]);
    setConfirmClear(false);
  };

  const handleExport = async (): Promise<void> => {
    const res = await api.dictionary.export();
    if (res.ok && res.path) {
      setStatusMessage("Dictionary exported successfully.");
    } else if (res.message && res.message !== "Export cancelled.") {
      setStatusMessage(`Export failed: ${res.message}`);
    }
  };

  const handleImport = async (): Promise<void> => {
    const res = await api.dictionary.import();
    if (res.ok) {
      setStatusMessage(
        `Added ${String(res.added)} rule${res.added === 1 ? "" : "s"}, skipped ${String(res.skipped)} duplicate${res.skipped === 1 ? "" : "s"}.`
      );
    } else if (res.message && res.message !== "Import cancelled.") {
      setStatusMessage(`Import failed: ${res.message}`);
    }
  };

  // Render text with matches highlighted
  const renderHighlightedSample = (): JSX.Element => {
    const enabledRules = dictionary.filter((r) => r.enabled && r.from.length > 0);
    if (enabledRules.length === 0 || sample.length === 0) {
      return <span>{sample}</span>;
    }

    const ranges: { start: number; end: number }[] = [];
    for (const rule of enabledRules) {
      for (const m of findRuleMatches(sample, rule)) {
        ranges.push({ start: m.start, end: m.end });
      }
    }
    if (ranges.length === 0) {
      return <span>{sample}</span>;
    }

    // Merge overlapping/adjacent ranges
    ranges.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (!last || r.start > last.end) {
        merged.push({ ...r });
      } else {
        last.end = Math.max(last.end, r.end);
      }
    }

    const nodes: JSX.Element[] = [];
    let curr = 0;
    merged.forEach((range, idx) => {
      if (range.start > curr) {
        nodes.push(<span key={`t-${String(curr)}`}>{sample.slice(curr, range.start)}</span>);
      }
      nodes.push(
        <mark
          key={`m-${String(range.start)}-${String(idx)}`}
          className="rounded-sm bg-accent-soft px-0.5 text-accent-text"
        >
          {sample.slice(range.start, range.end)}
        </mark>
      );
      curr = range.end;
    });
    if (curr < sample.length) {
      nodes.push(<span key={`t-${String(curr)}`}>{sample.slice(curr)}</span>);
    }

    return <>{nodes}</>;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <PageBody>
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            <SearchInput
              id={SEARCH_INPUT_ID}
              value={query}
              onChange={setQuery}
              onClear={() => {
                setQuery("");
              }}
              placeholder="Search rules"
              className="w-[240px]"
            />
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => void handleImport()}>
                Import
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void handleExport()}>
                Export
              </Button>
            </div>
          </div>
          {statusMessage && (
            <div className="rounded-md border border-border bg-surface px-4 py-2.5 text-xs text-text">
              {statusMessage}
            </div>
          )}

          {/* Add or Edit Rule Card */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {editingFrom !== null ? "Edit Rule" : "Add a Rule"}
              </h2>
              {editingFrom !== null && (
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                  Cancel Edit
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-[200px] flex-1 items-center gap-2">
                <TextInput
                  ref={fromInputRef}
                  value={draft.from}
                  onChange={(e) => {
                    setDraft((curr) => ({ ...curr, from: e.target.value }));
                    if (error) setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddOrUpdateRule();
                  }}
                  placeholder="Heard as (e.g. struck)"
                  className="flex-1"
                />
                <span className="text-text-muted">→</span>
                <TextInput
                  value={draft.to}
                  onChange={(e) => {
                    setDraft((curr) => ({ ...curr, to: e.target.value }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddOrUpdateRule();
                  }}
                  placeholder="Should be (e.g. Struq)"
                  className="flex-1"
                />
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setDraft((curr) => ({ ...curr, matchCase: !curr.matchCase }));
                  }}
                  title="Match capitalisation"
                  className="cursor-pointer"
                >
                  <Badge tone={draft.matchCase ? "accent" : "neutral"}>
                    <Icon icon="ph:text-aa" className="mr-1 inline h-3.5 w-3.5" />
                    Aa
                  </Badge>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft((curr) => ({ ...curr, wholeWord: !curr.wholeWord }));
                  }}
                  title="Whole words only"
                  className="cursor-pointer"
                >
                  <Badge tone={draft.wholeWord ? "accent" : "neutral"}>
                    <Icon icon="ph:selection" className="mr-1 inline h-3.5 w-3.5" />
                    ab|
                  </Badge>
                </button>
              </div>

              <Button variant="primary" size="sm" onClick={handleAddOrUpdateRule}>
                {editingFrom !== null ? "Save Rule" : "Add Rule"}
              </Button>
            </div>
            {error && <InlineError className="mt-2">{error}</InlineError>}
          </div>

          {/* Try It Sandbox */}
          <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Try It
              </h2>
              <span className="text-2xs text-text-muted" data-numeric>
                {String(firingCount)} of {String(dictionary.length)} rules firing
              </span>
            </div>
            <textarea
              rows={3}
              value={sample}
              onChange={(e) => {
                setSample(e.target.value);
              }}
              placeholder="Type a sentence here to test your rules..."
              className="w-full rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
              data-selectable
            />
            <div className="min-h-[42px] rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm text-text">
              <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                Matches in sample:
              </div>
              <div className="leading-snug">{renderHighlightedSample()}</div>
            </div>
            <div className="min-h-[42px] rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm text-text">
              <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                Result after replacements:
              </div>
              <div className="leading-snug">{preview}</div>
            </div>
          </div>

          {/* Rules List Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {String(dictionary.length)} Rule{dictionary.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as "recent" | "alphabetical");
                }}
              >
                <option value="recent">Recent first</option>
                <option value="alphabetical">Alphabetical</option>
              </Select>
              {dictionary.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirmClear(true);
                  }}
                >
                  Clear all
                </Button>
              )}
            </div>
          </div>

          {/* Rules List or Empty State */}
          {dictionary.length === 0 ? (
            <div className="flex flex-col gap-4">
              <EmptyState
                icon="ph:book-open-text"
                title="No rules yet"
                body="Add a word Struq Voice keeps getting wrong. Company names, people's names, and technical terms are the usual suspects."
              />
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-text-muted">Starter suggestions:</span>
                <div className="flex flex-wrap justify-center gap-2">
                  {STARTER_SUGGESTIONS.map((sugg) => (
                    <button
                      key={sugg.from}
                      type="button"
                      onClick={() => {
                        setDraft({
                          from: sugg.from,
                          to: sugg.to,
                          matchCase: false,
                          wholeWord: true
                        });
                        fromInputRef.current?.focus();
                      }}
                      className="cursor-pointer rounded-full border border-border bg-surface px-3 py-1 text-xs text-text transition-colors hover:border-accent hover:bg-surface-hover"
                    >
                      {sugg.from} → {sugg.to}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((rule) => {
                const isEnabled = rule.enabled;
                const isArmed = deleteArmedFrom === rule.from;
                return (
                  <div
                    key={rule.from}
                    className="flex h-11 items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-2"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Switch
                        checked={isEnabled}
                        onChange={() => {
                          handleToggleEnabled(rule.from);
                        }}
                      />
                      <span
                        className={`min-w-0 truncate text-sm ${
                          isEnabled ? "text-text" : "text-text-muted"
                        }`}
                      >
                        <span className="font-medium">{rule.from}</span>
                        <span className="mx-2 text-text-muted">→</span>
                        <span>{rule.to.length === 0 ? "(delete)" : rule.to}</span>
                      </span>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {rule.matchCase && <Badge tone="accent">Aa</Badge>}
                      {rule.wholeWord && <Badge tone="neutral">ab|</Badge>}
                      <IconButton
                        icon="ph:pencil-simple"
                        label="Edit rule"
                        size="sm"
                        onClick={() => {
                          handleStartEdit(rule);
                        }}
                      />
                      {isArmed ? (
                        <button
                          type="button"
                          onClick={() => {
                            handleRemoveRule(rule.from);
                          }}
                          onBlur={() => {
                            setDeleteArmedFrom(null);
                          }}
                          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-danger bg-danger px-2 text-2xs font-semibold uppercase tracking-wide text-text-inverse"
                        >
                          Delete?
                        </button>
                      ) : (
                        <IconButton
                          icon="ph:trash"
                          label="Delete rule"
                          size="sm"
                          variant="danger"
                          onClick={() => {
                            setDeleteArmedFrom(rule.from);
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </PageBody>

      <Dialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear the dictionary?"
        description={`This will permanently remove all ${String(dictionary.length)} rule${
          dictionary.length === 1 ? "" : "s"
        }. This action cannot be undone.`}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirmClear(false);
              }}
            >
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={handleClearAll}>
              Clear dictionary
            </Button>
          </>
        }
      />
    </div>
  );
}
