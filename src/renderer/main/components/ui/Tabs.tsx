import type { JSX } from "react";
import { motion } from "motion/react";
import { Icon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * A horizontal or vertical row of tab buttons. A single shared indicator
 * element glides between the active tab via layoutId, so the user sees a
 * continuous underline that moves with their selection.
 */
export interface TabsItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string | IconifyIcon;
  readonly shortcut?: string;
}

export interface TabsProps {
  readonly items: readonly TabsItem[];
  readonly active: string;
  readonly onSelect: (next: string) => void;
  readonly orientation?: "horizontal" | "vertical";
  readonly className?: string;
}

export function Tabs({
  items,
  active,
  onSelect,
  orientation = "horizontal",
  className
}: TabsProps): JSX.Element {
  if (orientation === "vertical") {
    return (
      <div role="tablist" className={cn("flex w-full flex-col gap-0.5", className)}>
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={isActive}
              onClick={() => {
                onSelect(item.id);
              }}
              className={cn(
                "relative flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm",
                "transition-colors duration-hover",
                isActive
                  ? "bg-surface font-medium text-text"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="tab-vertical-indicator"
                  className="absolute left-0 top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-r-pill bg-accent"
                  transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}
                />
              )}
              {item.icon !== undefined && (
                <Icon icon={item.icon} className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut !== undefined && (
                <span className="text-2xs text-text-muted">{item.shortcut}</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="tablist" className={cn("relative flex items-center justify-center gap-6 sm:gap-8 overflow-x-auto", className)}>
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => {
              onSelect(item.id);
            }}
            className={cn(
              "relative inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-t-sm px-4 text-sm font-medium",
              "transition-colors duration-hover",
              isActive ? "text-text" : "text-text-secondary hover:text-text"
            )}
          >
            {isActive && (
              <motion.span
                layoutId="tab-horizontal-underline"
                className="absolute inset-x-0 bottom-0 h-[2px] rounded-t-pill bg-accent"
                transition={{ duration: 0.28, ease: [0.25, 1, 0.5, 1] }}
              />
            )}
            {item.icon !== undefined && (
              <Icon icon={item.icon} className="h-4 w-4" aria-hidden="true" />
            )}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
