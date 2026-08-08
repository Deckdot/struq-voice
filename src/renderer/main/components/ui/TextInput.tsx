import { forwardRef } from "react";
import type { InputHTMLAttributes, JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * A single-line text field. Leading and trailing slots accept an icon name;
 * the trailing slot can be made interactive. The border shifts to accent on
 * focus, never the whole background, so the field reads as ready, not hot.
 */
export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  readonly size?: "sm" | "md";
  readonly invalid?: boolean;
  readonly leadingIcon?: string | IconifyIcon;
  readonly trailingIcon?: string | IconifyIcon;
  readonly onTrailingClick?: () => void;
  readonly trailingLabel?: string;
  readonly trailingSlot?: ReactNode;
  readonly containerClassName?: string;
}

const HEIGHTS: Record<"sm" | "md", string> = {
  sm: "h-7 text-xs",
  md: "h-8 text-sm"
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    size = "md",
    invalid = false,
    leadingIcon,
    trailingIcon,
    onTrailingClick,
    trailingLabel = "Clear",
    trailingSlot,
    containerClassName,
    className,
    ...rest
  },
  ref
): JSX.Element {
  const hasLeading = leadingIcon !== undefined;
  const hasTrailing = trailingIcon !== undefined || trailingSlot !== undefined;
  const showTrailingButton = trailingIcon !== undefined;
  return (
    <div
      className={cn(
        "relative inline-flex w-full items-center rounded-md border bg-bg-sunken transition-colors duration-hover",
        "focus-within:border-accent",
        invalid ? "border-danger" : "border-border",
        HEIGHTS[size],
        containerClassName
      )}
    >
      {hasLeading && (
          <span className="pointer-events-none absolute left-2.5 inline-flex text-text-muted">
          <Icon
            icon={leadingIcon}
            className="h-4 w-4"
            aria-hidden="true"
          />
        </span>
      )}
      <input
        ref={ref}
        className={cn(
          "h-full w-full bg-transparent text-text placeholder:text-text-muted focus:outline-none",
          hasLeading ? "pl-8" : "pl-3",
          hasTrailing ? "pr-8" : "pr-3",
          className
        )}
        {...rest}
      />
      {hasTrailing && (
        <span className="absolute right-2 inline-flex text-text-muted">
          {trailingSlot !== undefined ? (
            trailingSlot
          ) : showTrailingButton ? (
            <button
              type="button"
              tabIndex={onTrailingClick === undefined ? -1 : 0}
              onClick={onTrailingClick}
              className={cn(
                "inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm",
                onTrailingClick !== undefined && "hover:bg-surface-hover hover:text-text"
              )}
              aria-label={trailingLabel}
              title={trailingLabel}
            >
              <Icon
                icon={trailingIcon}
                className="h-4 w-4"
                aria-hidden="true"
              />
            </button>
          ) : null}
        </span>
      )}
    </div>
  );
});
