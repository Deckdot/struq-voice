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
  Button,
  Dialog,
  EmptyState,
  IconButton,
  InlineError,
  Select,
  Switch,
  TextInput
} from "../components/ui";

import { useTranslation } from "../lib/useTranslation";

interface Draft {
  readonly from: string;
  readonly to: string;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
}

/**
 * Every rule is whole-word and case-insensitive, and neither is a choice.
 *
 * These were two toggles. Case matching earned nothing: speech has no
 * capitalisation, so the engine decides it, and a case-sensitive rule for
 * "struck" then misses "Struck" at the start of a sentence, which is exactly
 * where it matters. Whole-word is the opposite, it must always be on: off, a
 * rule for "cat" quietly rewrites the middle of "category", and the damage is
 * invisible until someone reads the transcript.
 *
 * The schema keeps both fields so existing profiles parse unchanged.
 */
const RULE_MATCHING = { matchCase: false, wholeWord: true } as const;

const EMPTY_DRAFT: Draft = { from: "", to: "", ...RULE_MATCHING };

/**
 * Examples for someone who has never written a rule.
 *
 * The old set was GitHub and PostgreSQL, which only reads as a useful idea if
 * you already work in software. These are the corrections anyone dictating
 * hits in their first week: an email address that comes out as words, a name
 * spelled the common way instead of theirs, a phrase heard as the wrong word.
 * They prefill the form rather than adding a rule, so nothing lands in the
 * dictionary without a deliberate click.
 */
const STARTER_SUGGESTIONS: readonly { from: string; to: string }[] = [
  { from: "at gmail dot com", to: "@gmail.com" },
  { from: "Sara", to: "Sarah" },
  { from: "kind regards", to: "Kind regards," }
];

export function DictionaryView(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const { t } = useTranslation();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sort, setSort] = useState<"recent" | "alphabetical">("recent");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [deleteArmedFrom, setDeleteArmedFrom] = useState<string | null>(null);

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
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && editingFrom !== null) {
        setEditingFrom(null);
        setDraft(EMPTY_DRAFT);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [editingFrom]);

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
    return sort === "alphabetical"
      ? [...dictionary].sort((a, b) => a.from.localeCompare(b.from))
      : [...dictionary].reverse();
  }, [dictionary, sort]);

  const activeSample = sample.length > 0 ? sample : t("dictionary.typeSample");
  const preview = useMemo(() => applyDictionary(activeSample, dictionary), [activeSample, dictionary]);
  const hits = useMemo(() => countRuleHits(activeSample, dictionary), [activeSample, dictionary]);
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
      setError(t("dictionary.err.emptyFrom"));
      return;
    }
    if (checkDuplicate(trimmedFrom, editingFrom)) {
      setError(t("dictionary.err.duplicate", { from: trimmedFrom }));
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

  // Render text with matches highlighted
  const renderHighlightedSample = (): JSX.Element => {
    const enabledRules = dictionary.filter((r) => r.enabled && r.from.length > 0);
    if (enabledRules.length === 0 || activeSample.length === 0) {
      return <span>{activeSample}</span>;
    }

    const ranges: { start: number; end: number }[] = [];
    for (const rule of enabledRules) {
      for (const m of findRuleMatches(activeSample, rule)) {
        ranges.push({ start: m.start, end: m.end });
      }
    }
    if (ranges.length === 0) {
      return <span>{activeSample}</span>;
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
        nodes.push(<span key={`t-${String(curr)}`}>{activeSample.slice(curr, range.start)}</span>);
      }
      nodes.push(
        <mark
          key={`m-${String(range.start)}-${String(idx)}`}
          className="rounded-sm bg-accent-soft px-0.5 text-accent-text"
        >
          {activeSample.slice(range.start, range.end)}
        </mark>
      );
      curr = range.end;
    });
    if (curr < activeSample.length) {
      nodes.push(<span key={`t-${String(curr)}`}>{activeSample.slice(curr)}</span>);
    }

    return <>{nodes}</>;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg">
      <PageBody>
        <div className="flex flex-col gap-6">
          {/* Add or Edit Rule Card */}
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {editingFrom !== null ? t("dictionary.editRule") : t("dictionary.addRule")}
              </h2>
              {editingFrom !== null && (
                <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                  {t("dictionary.cancelEdit")}
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
                  placeholder={t("dictionary.heardAs")}
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
                  placeholder={t("dictionary.shouldBe")}
                  className="flex-1"
                />
              </div>

              <Button variant="primary" size="sm" onClick={handleAddOrUpdateRule}>
                {editingFrom !== null ? t("dictionary.saveRule") : t("dictionary.addRule")}
              </Button>
            </div>
            {error && <InlineError className="mt-2">{error}</InlineError>}
          </div>

          {/* Try It Sandbox */}
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {t("dictionary.tryIt")}
              </h2>
              <span className="text-2xs text-text-muted" data-numeric>
                {t("dictionary.firingCount", { firing: firingCount, total: dictionary.length })}
              </span>
            </div>
            <textarea
              rows={2}
              value={sample}
              onChange={(e) => {
                setSample(e.target.value);
              }}
              placeholder={t("dictionary.typeSample")}
              className="w-full rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm text-text transition-colors duration-hover focus:border-accent focus:outline-none"
              data-selectable
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex min-h-[42px] flex-col justify-center rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm text-text">
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  {t("dictionary.matchesSample")}
                </div>
                <div className="leading-snug">{renderHighlightedSample()}</div>
              </div>
              <div className="flex min-h-[42px] flex-col justify-center rounded-md border border-border bg-bg-sunken px-3 py-2 text-sm text-text">
                <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-text-muted">
                  {t("dictionary.resultSample")}
                </div>
                <div className="leading-snug">{preview}</div>
              </div>
            </div>
          </div>

          {/* Rules List Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-text-muted">
                {t("dictionary.rulesCount", { count: dictionary.length })}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value as "recent" | "alphabetical");
                }}
              >
                <option value="recent">{t("dictionary.sort.recent")}</option>
                <option value="alphabetical">{t("dictionary.sort.alphabetical")}</option>
              </Select>
              {dictionary.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setConfirmClear(true);
                  }}
                >
                  {t("dictionary.clearAll")}
                </Button>
              )}
            </div>
          </div>

          {/* Rules List or Empty State */}
          {dictionary.length === 0 ? (
            <div className="flex flex-col gap-4 py-2">
              <EmptyState
                icon="ph:book-open-text"
                title={t("dictionary.empty.title")}
                body={t("dictionary.empty.body")}
              />
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs text-text-muted">{t("dictionary.starterSuggestions")}</span>
                <div className="flex flex-wrap justify-center gap-2">
                  {STARTER_SUGGESTIONS.map((sugg) => (
                    <button
                      key={sugg.from}
                      type="button"
                      onClick={() => {
                        setDraft({ from: sugg.from, to: sugg.to, ...RULE_MATCHING });
                        fromInputRef.current?.focus();
                      }}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text transition-colors hover:border-accent hover:bg-surface-hover"
                    >
                      <Icon icon="ph:plus" className="h-3 w-3 text-accent" />
                      <span>{sugg.from} → {sugg.to}</span>
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
                      <IconButton
                        icon="ph:pencil-simple"
                        label={t("dictionary.editRuleLabel")}
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
                          {t("dictionary.deletePrompt")}
                        </button>
                      ) : (
                        <IconButton
                          icon="ph:trash"
                          label={t("dictionary.deleteRuleLabel")}
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
        title={t("dictionary.confirmClear.title")}
        description={t("dictionary.confirmClear.description", { count: dictionary.length })}
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setConfirmClear(false);
              }}
            >
              {t("dictionary.confirmClear.cancel")}
            </Button>
            <Button variant="danger" size="sm" onClick={handleClearAll}>
              {t("dictionary.confirmClear.confirm")}
            </Button>
          </>
        }
      />
    </div>
  );
}
