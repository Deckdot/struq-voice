import type { JSX, ReactNode } from "react";
import { motion } from "motion/react";
import { Icon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * A small group of mutually exclusive choices, the kind of thing a Settings
 * panel uses to pick between three or four related options (e.g. the
 * System/Light/Dark theme). The active option sits on a shared "lifted
 * surface" that glides between choices via a layoutId, rather than each
 * option having its own active background.
 */
export interface SegmentedControlOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: string | IconifyIcon;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentedControlOption<T>[];
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className
}: SegmentedControlProps<T>): JSX.Element {
  return (
    <div
      role="tablist"
      className={cn(
        "relative inline-flex items-center gap-0.5 rounded-md border border-border bg-bg-sunken p-0.5",
        className
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        const content: ReactNode = (
          <span
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-sm",
              "transition-colors duration-hover",
              size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
              active ? "text-text" : "text-text-secondary"
            )}
          >
            {active && (
              <motion.span
                layoutId="segmented-active"
                className="absolute inset-0 rounded-sm bg-surface shadow-lift"
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
              />
            )}
            <span className="relative inline-flex items-center gap-1.5">
              {option.icon !== undefined && (
                <Icon icon={option.icon} className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {option.label}
            </span>
          </span>
        );
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              onChange(option.value);
            }}
            className="relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}
