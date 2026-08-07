import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { motion } from "motion/react";
import type { Route } from "../store/use-main-store";
import { ROUTE_ORDER, useMainStore } from "../store/use-main-store";
import { isMeetingActive } from "../../../shared/meeting";
import { StatusCluster } from "./StatusCluster";
import { StatusDot } from "./ui";
import { cn } from "../lib/cn";
import { useTranslation } from "../lib/useTranslation";
import type { MessageKey } from "../../../shared/i18n";

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

/**
 * The left navigation rail. Four routes, icon plus label, the status cluster
 * pinned to the bottom. The active row carries a 3px accent edge that glides
 * between rows via a shared layoutId.
 */
export function Rail(): JSX.Element {
  const route = useMainStore((state) => state.route);
  const setRoute = useMainStore((state) => state.setRoute);
  const meetingActive = useMainStore((state) => isMeetingActive(state.meeting));
  const { t } = useTranslation();

  return (
    <nav
      className="flex w-[184px] shrink-0 flex-col border-r border-border bg-bg"
      aria-label={t("app.name")}
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
                "relative flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-start text-sm transition-colors duration-hover",
                active
                  ? "font-medium text-text"
                  : "text-text-secondary hover:bg-surface-hover/60 hover:text-text"
              )}
            >
              {active && (
                <motion.span
                  layoutId="nav-rail-active-pill"
                  className="absolute inset-0 rounded-md border border-border/60 bg-surface shadow-xs"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <Icon
                icon={ROUTE_ICONS[item]}
                className={cn(
                  "relative z-10 h-[18px] w-[18px] transition-colors",
                  active ? "text-accent" : "text-text-muted"
                )}
                aria-hidden="true"
              />
              <span className="relative z-10">{t(ROUTE_KEYS[item])}</span>
              {item === "meetings" && meetingActive && (
                // A live meeting is the one thing worth interrupting the
                // label for: the rail is where a user looks to know that
                // something is running.
                <StatusDot state="listening" className="relative z-10 ms-auto" />
              )}
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
              "relative flex h-9 w-full cursor-pointer items-center gap-3 rounded-md px-3 text-start text-sm transition-colors duration-hover",
              route === "settings"
                ? "font-medium text-text"
                : "text-text-secondary hover:bg-surface-hover/60 hover:text-text"
            )}
          >
            {route === "settings" && (
              <motion.span
                layoutId="nav-rail-active-pill"
                className="absolute inset-0 rounded-md border border-border/60 bg-surface shadow-xs"
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <Icon
              icon={ROUTE_ICONS.settings}
              className={cn(
                "relative z-10 h-[18px] w-[18px] transition-colors",
                route === "settings" ? "text-accent" : "text-text-muted"
              )}
              aria-hidden="true"
            />
            <span className="relative z-10">{t("nav.settings")}</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
