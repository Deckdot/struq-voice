import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import type { Route } from "../store/use-main-store";
import { ROUTE_LABELS, ROUTE_ORDER, useMainStore } from "../store/use-main-store";
import { StatusCluster } from "./StatusCluster";
import { cn } from "../lib/cn";

const ROUTE_ICONS: Record<Route, string> = {
  dictate: "ph:microphone",
  history: "ph:clock-counter-clockwise",
  models: "ph:cube",
  settings: "ph:gear"
};

/**
 * The left navigation rail. Four routes, icon plus label, the status cluster
 * pinned to the bottom. The active row carries a 3px accent edge that glides
 * between rows via a shared layoutId.
 */
export function Rail(): JSX.Element {
  const route = useMainStore((state) => state.route);
  const setRoute = useMainStore((state) => state.setRoute);

  return (
    <nav
      className="flex w-[184px] shrink-0 flex-col border-r border-border bg-bg-sunken"
      aria-label="Struq Voice"
    >
      <div className="flex flex-col gap-0.5 p-2">
        {ROUTE_ORDER.filter((item) => item !== "settings").map((item) => {
          const active = item === route;
          return (
            <button
              key={item}
              type="button"
              onClick={() => {
                setRoute(item);
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left text-sm text-text-secondary transition-colors duration-hover hover:bg-surface-hover hover:text-text",
                active && "bg-surface font-medium text-text"
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-rail-indicator"
                  className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-pill bg-accent"
                />
              )}
              <Icon icon={ROUTE_ICONS[item]} className="h-[18px] w-[18px]" aria-hidden="true" />
              {ROUTE_LABELS[item]}
            </button>
          );
        })}
      </div>
      <div className="mt-auto flex flex-col">
        <StatusCluster />
        <div className="border-t border-border p-2">
          <button
            type="button"
            onClick={() => {
              setRoute("settings");
            }}
            aria-current={route === "settings" ? "page" : undefined}
            className={cn(
              "relative flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-left text-sm text-text-secondary transition-colors duration-hover hover:bg-surface-hover hover:text-text",
              route === "settings" && "bg-surface font-medium text-text"
            )}
          >
            {route === "settings" && (
              <motion.span
                layoutId="nav-rail-indicator"
                className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-pill bg-accent"
              />
            )}
            <Icon icon={ROUTE_ICONS.settings} className="h-[18px] w-[18px]" aria-hidden="true" />
            {ROUTE_LABELS.settings}
          </button>
        </div>
      </div>
    </nav>
  );
}
