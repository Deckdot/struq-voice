import { forwardRef } from "react";
import type { JSX, SelectHTMLAttributes } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * A native select, styled. Native controls are reliable on Windows: the OS
 * knows the user's language, keyboard, and accessibility preferences, and
 * shipping a custom dropdown means re-implementing all of that. A chevron
 * is overlaid for visual consistency with the rest of the library.
 */
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  readonly size?: "sm" | "md";
  readonly invalid?: boolean;
}

const HEIGHTS: Record<"sm" | "md", string> = {
  sm: "h-7 text-xs",
  md: "h-8 text-sm"
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = "md", invalid = false, className, children, ...rest },
  ref
): JSX.Element {
  return (
    <div
      className={cn(
        "relative inline-flex w-full items-center rounded-md border bg-bg-sunken transition-colors duration-hover",
        "focus-within:border-accent",
        invalid ? "border-danger" : "border-border",
        HEIGHTS[size]
      )}
    >
      <select
        ref={ref}
        className={cn(
          "h-full w-full appearance-none bg-transparent pl-3 pr-8 text-text focus:outline-none",
          className
        )}
        {...rest}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-2.5 inline-flex text-text-muted">
        <Icon icon="ph:caret-down" className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </div>
  );
});
