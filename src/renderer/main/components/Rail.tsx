import type { JSX } from "react";
import { Mic, History, Boxes, Settings, type LucideIcon } from "lucide-react";
import type { Route } from "../store/use-main-store";
import { ROUTE_LABELS } from "../store/use-main-store";
import { cn } from "../lib/cn";

const ROUTE_ICONS: Record<Route, LucideIcon> = {
  dictate: Mic,
  history: History,
  models: Boxes,
  settings: Settings
};

const ROUTE_ORDER: readonly Route[] = ["dictate", "history", "models", "settings"];

export interface RailProps {
  readonly route: Route;
  readonly onSelect: (route: Route) => void;
}

/**
 * The slim left rail. Four routes, icon plus label, no more. The active
 * route is marked with a surface step and the forest accent, never with
 * hue gymnastics: interaction moves lightness only.
 */
export function Rail({ route, onSelect }: RailProps): JSX.Element {
  return (
    <nav
      className="flex w-44 shrink-0 flex-col gap-0.5 border-r border-border bg-bg-sunken p-2"
      aria-label="Struq Voice"
    >
      <div className="flex items-center gap-2 px-2 pb-3 pt-1">
        <span className="h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
        <span className="font-serif text-base tracking-tight text-text">Struq Voice</span>
      </div>
      {ROUTE_ORDER.map((item) => {
        const Icon = ROUTE_ICONS[item];
        const active = item === route;
        return (
          <button
            key={item}
            type="button"
            onClick={() => {
              onSelect(item);
            }}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors duration-fast",
              active
                ? "bg-surface text-text shadow-float"
                : "text-text-muted hover:bg-surface-hover hover:text-text"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {ROUTE_LABELS[item]}
          </button>
        );
      })}
    </nav>
  );
}
