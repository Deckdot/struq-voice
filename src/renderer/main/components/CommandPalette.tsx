import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Command } from "cmdk";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@iconify/react";
import type { MainWindowApi } from "../../../shared/api";
import { ROUTE_LABELS, ROUTE_ORDER, useMainStore } from "../store/use-main-store";
import type { Route } from "../store/use-main-store";

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

const ROUTE_ICONS: Record<Route, string> = {
  dictate: "ph:microphone",
  history: "ph:clock-counter-clockwise",
  models: "ph:cube",
  settings: "ph:gear"
};

const SETTINGS_CATEGORIES: readonly { id: string; label: string; icon: string }[] = [
  { id: "general", label: "General", icon: "ph:sliders-horizontal" },
  { id: "capture", label: "Capture", icon: "ph:microphone" },
  { id: "transcription", label: "Transcription", icon: "ph:wave-sine" },
  { id: "delivery", label: "Delivery", icon: "ph:clipboard-text" },
  { id: "text", label: "Text", icon: "ph:text-t" },
  { id: "appearance", label: "Appearance", icon: "ph:circle-half" }
];

const ITEM_CLASS =
  "flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-hover";

/**
 * The Ctrl+K command palette, built on cmdk. It is the same enumeration the
 * tray menu and the rail use: the four routes, the one-shot actions, and the
 * settings tabs, so every surface ships the same commands.
 */
export function CommandPalette({ open, onOpenChange }: CommandPaletteProps): JSX.Element | null {
  const api = window.struqVoice as MainWindowApi;
  const setRoute = useMainStore((state) => state.setRoute);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
  }, [open]);

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
                  icon="ph:command"
                  className="h-4 w-4 shrink-0 text-text-muted"
                  aria-hidden="true"
                />
                <Command.Input
                  placeholder="Type a command or search..."
                  className="h-11 w-full bg-transparent text-base text-text placeholder:text-text-muted focus:outline-none"
                />
              </div>
              <Command.List className="max-h-72 overflow-y-auto p-1.5">
                <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
                  No results
                </Command.Empty>

                <Command.Group heading="Pages">
                  {ROUTE_ORDER.map((route, index) => {
                    return (
                      <Command.Item
                        key={route}
                        value={`page-${ROUTE_LABELS[route]}`}
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
                          {ROUTE_LABELS[route]}
                        </span>
                        <span className="text-xs text-text-muted">Ctrl+{index + 1}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>

                <Command.Group heading="Actions">
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
                    {copied ? "Copied" : "Copy last transcript"}
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
                    Check for updates
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
                    Use system theme
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
                    Use light theme
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
                    Use dark theme
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
                    Reset panel position
                  </Command.Item>
                </Command.Group>

                <Command.Group heading="Settings">
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
                        {category.label}
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
