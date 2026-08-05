import { useEffect, useState } from "react";
import type { JSX } from "react";
import { Command } from "cmdk";
import { Mic, History, Boxes, Settings, Copy } from "lucide-react";
import type { Route } from "../store/use-main-store";
import { ROUTE_LABELS } from "../store/use-main-store";
import type { MainWindowApi } from "../../../shared/api";

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onNavigate: (route: Route) => void;
}

const ROUTE_ICONS: Record<Route, typeof Mic> = {
  dictate: Mic,
  history: History,
  models: Boxes,
  settings: Settings
};

const ROUTE_ORDER: readonly Route[] = ["dictate", "history", "models", "settings"];

/**
 * The Ctrl+K command palette, built on cmdk. Nearly free once the tray menu
 * actions are already enumerated: it exposes the same routes plus the copy
 * action. Rendered as an overlay; closed on Escape and on blur.
 */
export function CommandPalette({
  open,
  onOpenChange,
  onNavigate
}: CommandPaletteProps): JSX.Element | null {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCopied(false);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-text/20 pt-[15vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <Command
        className="w-[32rem] max-w-[calc(100vw-4rem)] overflow-hidden rounded-lg border border-border bg-surface shadow-float"
        onKeyDown={(event) => {
          if (event.key === "Escape") onOpenChange(false);
        }}
      >
        <Command.Input
          placeholder="Type a command or search..."
          className="w-full border-b border-border bg-transparent px-4 py-3 text-base text-text placeholder:text-text-muted focus:outline-none"
        />
        <Command.List className="max-h-72 overflow-y-auto p-1.5">
          <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
            No results.
          </Command.Empty>

          <Command.Group heading="Views">
            {ROUTE_ORDER.map((route) => {
              const Icon = ROUTE_ICONS[route];
              return (
                <Command.Item
                  key={route}
                  onSelect={() => {
                    onNavigate(route);
                    onOpenChange(false);
                  }}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-hover"
                >
                  <Icon className="h-4 w-4 text-text-muted" aria-hidden="true" />
                  {ROUTE_LABELS[route]}
                </Command.Item>
              );
            })}
          </Command.Group>

          <Command.Group heading="Actions">
            <Command.Item
              onSelect={() => {
                const api = window.struqVoice as MainWindowApi;
                void api.history.list({ limit: 1 }).then(({ items }) => {
                  const latest = items[0];
                  if (latest === undefined) {
                    setCopied(true);
                    return;
                  }
                  api.clipboard.copy(latest.text);
                  setCopied(true);
                });
              }}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-text data-[selected=true]:bg-surface-hover"
            >
              <Copy className="h-4 w-4 text-text-muted" aria-hidden="true" />
              {copied ? "Copied" : "Copy last transcript"}
            </Command.Item>
          </Command.Group>
        </Command.List>
      </Command>
    </div>
  );
}
