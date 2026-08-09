import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import { ROUTE_ORDER, useMainStore } from "../store/use-main-store";
import type { Route } from "../store/use-main-store";

import { useTranslation } from "../lib/useTranslation";
import type { MessageKey } from "../../../shared/i18n";
import type { TranscriptRecord } from "../../../shared/ipc";

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const ROUTE_ICONS: Record<Route, string> = {
  dictate: "ph:microphone",
  meetings: "ph:users-three",
  history: "ph:clock-counter-clockwise",
  dictionary: "ph:book-open-text",
  models: "ph:cube",
  settings: "ph:gear"
};

const ROUTE_KEYS: Record<Route, MessageKey> = {
  dictate: "nav.dictate",
  meetings: "nav.meetings",
  history: "nav.history",
  dictionary: "nav.dictionary",
  models: "nav.models",
  settings: "nav.settings"
};

const SETTINGS_CATEGORIES: readonly { id: string; key: MessageKey; icon: string }[] = [
  { id: "general", key: "settings.category.general", icon: "ph:sliders-horizontal" },
  { id: "capture", key: "settings.category.capture", icon: "ph:microphone" },
  { id: "transcription", key: "settings.category.transcription", icon: "ph:wave-sine" },
  { id: "delivery", key: "settings.category.delivery", icon: "ph:clipboard-text" },
  { id: "text", key: "settings.category.text", icon: "ph:text-t" },
  { id: "appearance", key: "settings.category.appearance", icon: "ph:circle-half" }
];

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-hover";

/**
 * The Ctrl+F search palette, built on cmdk. It is the same enumeration the
 * tray menu and the rail use: the four routes, the one-shot actions, and the
 * settings tabs, so every surface ships the same commands.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps): JSX.Element | null {
  const api = window.struqVoice as MainWindowApi;
  const { t } = useTranslation();
  const setRoute = useMainStore((state) => state.setRoute);
  const setHistorySearch = useMainStore((state) => state.setHistorySearch);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly TranscriptRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const trimmed = query.trim();

  useEffect(() => {
    if (!open) return;
    setCopied(false);
    setQuery("");
    setHits([]);
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (trimmed.length === 0) {
      setHits([]);
      setSearching(false);
      return () => {
        cancelled = true;
      };
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api.history
        .search({ query: trimmed, limit: 5 })
        .then(({ items }) => {
          if (cancelled) return;
          setHits(items);
          setSearching(false);
        })
        .catch(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trimmed, api]);

  const close = (): void => {
    onOpenChange(false);
  };

  const navigate = (route: Route): void => {
    setRoute(route);
    close();
  };

  const openSettingsCategory = (category: string): void => {
    setRoute("settings");
    window.dispatchEvent(new CustomEvent("struq:open-settings-category", { detail: category }));
    close();
  };

  const copyLast = (): void => {
    void api.history.list({ limit: 1 }).then(({ items }) => {
      const latest = items[0];
      if (latest === undefined) {
        setCopied(true);
        return;
      }
      api.clipboard.copy(latest.text);
      setCopied(true);
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-text/30 pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.25, 1, 0.5, 1] }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.98, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -8 }}
            transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
            className="w-[36rem] max-w-[calc(100vw-4rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-float"
          >
            <Command
              onKeyDown={(event) => {
                if (event.key === "Escape") close();
              }}
            >
              <div className="flex items-center gap-2.5 border-b border-border px-4">
                <Icon
                  icon="ph:magnifying-glass"
                  className="h-4 w-4 shrink-0 text-text-muted"
                  aria-hidden="true"
                />
                <Command.Input
                  autoFocus
                  value={query}
                  onValueChange={setQuery}
                  placeholder={t("commandPalette.searchPlaceholder")}
                  className="h-11 w-full bg-transparent text-base text-text placeholder:text-text-muted focus:outline-none"
                />
                {query.length > 0 && (
                  <button
                    type="button"
                    aria-label={t("search.clear")}
                    title={t("search.clear")}
                    onClick={() => {
                      setQuery("");
                    }}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors duration-hover hover:bg-surface-hover hover:text-text active:bg-surface-active"
                  >
                    <Icon icon="ph:x" className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <Command.List className="max-h-72 overflow-y-auto p-1.5">
                <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
                  {t("commandPalette.empty")}
                </Command.Empty>

                {trimmed.length > 0 && (
                  <Command.Group heading={t("commandPalette.group.transcripts")}>
                    <Command.Item
                      value={`search-history ${trimmed}`}
                      onSelect={() => {
                        setRoute("history");
                        setHistorySearch({ query: trimmed, focusId: null });
                        close();
                      }}
                      className={ITEM_CLASS}
                    >
                      <Icon
                        icon={searching ? "ph:circle-notch" : "ph:magnifying-glass"}
                        className={`h-4 w-4 shrink-0 text-text-muted ${searching ? "motion-safe:animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                      {t("commandPalette.searchInHistory", { query: trimmed })}
                    </Command.Item>
                    {hits.map((hit) => {
                      const collapsed = hit.text.replace(/\s+/g, " ").trim();
                      const label = collapsed.length > 90 ? `${collapsed.slice(0, 90)}…` : collapsed;
                      return (
                        <Command.Item
                          key={String(hit.id)}
                          value={`transcript-${String(hit.id)}`}
                          keywords={[collapsed]}
                          title={hit.text}
                          onSelect={() => {
                            setRoute("history");
                            setHistorySearch({ query: trimmed, focusId: hit.id });
                            close();
                          }}
                          className={ITEM_CLASS}
                        >
                          <Icon
                            icon="ph:article"
                            className="h-4 w-4 shrink-0 text-text-muted"
                            aria-hidden="true"
                          />
                          <span className="min-w-0 truncate">{label}</span>
                        </Command.Item>
                      );
                    })}
                  </Command.Group>
                )}

                <Command.Group heading={t("commandPalette.group.pages")}>
                  {ROUTE_ORDER.map((route, index) => {
                    return (
                      <Command.Item
                        key={route}
                        value={`page-${t(ROUTE_KEYS[route])}`}
                        onSelect={() => {
                          navigate(route);
                        }}
                        className={`${ITEM_CLASS} justify-between`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Icon
                            icon={ROUTE_ICONS[route]}
                            className="h-4 w-4 shrink-0 text-text-muted"
                            aria-hidden="true"
                          />
                          {t(ROUTE_KEYS[route])}
                        </span>
                        <span className="text-xs text-text-muted">Ctrl+{index + 1}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>

                <Command.Group heading={t("commandPalette.group.actions")}>
                  <Command.Item
                    value="copy-last-transcript"
                    onSelect={copyLast}
                    className={ITEM_CLASS}
                  >
                    <Icon
                      icon={copied ? "ph:check" : "ph:clipboard-text"}
                      className="h-4 w-4 text-text-muted"
                      aria-hidden="true"
                    />
                    {copied ? t("commandPalette.action.copied") : t("commandPalette.action.copyLast")}
                  </Command.Item>
                  <Command.Item
                    value="check-updates"
                    onSelect={() => {
                      void api.updates.check();
                      close();
                    }}
                    className={ITEM_CLASS}
                  >
                    <Icon
                      icon="ph:arrow-clockwise"
                      className="h-4 w-4 text-text-muted"
                      aria-hidden="true"
                    />
                    {t("commandPalette.action.checkUpdates")}
                  </Command.Item>
                  <Command.Item
                    value="theme-system"
                    onSelect={() => {
                      void api.settings.update({ theme: "system" });
                      close();
                    }}
                    className={ITEM_CLASS}
                  >
                    <Icon icon="ph:circle-half" className="h-4 w-4 text-text-muted" aria-hidden="true" />
                    {t("commandPalette.action.themeSystem")}
                  </Command.Item>
                  <Command.Item
                    value="theme-light"
                    onSelect={() => {
                      void api.settings.update({ theme: "light" });
                      close();
                    }}
                    className={ITEM_CLASS}
                  >
                    <Icon icon="ph:sun" className="h-4 w-4 text-text-muted" aria-hidden="true" />
                    {t("commandPalette.action.themeLight")}
                  </Command.Item>
                  <Command.Item
                    value="theme-dark"
                    onSelect={() => {
                      void api.settings.update({ theme: "dark" });
                      close();
                    }}
                    className={ITEM_CLASS}
                  >
                    <Icon icon="ph:moon" className="h-4 w-4 text-text-muted" aria-hidden="true" />
                    {t("commandPalette.action.themeDark")}
                  </Command.Item>
                  <Command.Item
                    value="reset-panel"
                    onSelect={() => {
                      void api.settings.update({ overlayPosition: null });
                      close();
                    }}
                    className={ITEM_CLASS}
                  >
                    <Icon icon="ph:monitor" className="h-4 w-4 text-text-muted" aria-hidden="true" />
                    {t("commandPalette.action.resetPanel")}
                  </Command.Item>
                </Command.Group>

                <Command.Group heading={t("commandPalette.group.settings")}>
                  {SETTINGS_CATEGORIES.map((category) => {
                    return (
                      <Command.Item
                        key={category.id}
                        value={`settings-${category.id}`}
                        onSelect={() => {
                          openSettingsCategory(category.id);
                        }}
                        className={ITEM_CLASS}
                      >
                        <Icon
                          icon={category.icon}
                          className="h-4 w-4 text-text-muted"
                          aria-hidden="true"
                        />
                        {t(category.key)}
                      </Command.Item>
                    );
                  })}
                </Command.Group>
              </Command.List>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
