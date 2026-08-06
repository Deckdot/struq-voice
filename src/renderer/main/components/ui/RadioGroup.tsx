import * as RadixRadio from "@radix-ui/react-radio-group";
import type { JSX, ReactNode } from "react";
import { Icon } from "@iconify/react";
import type { IconifyIcon } from "@iconify/react";
import { cn } from "../../lib/cn";
import { Badge } from "./Badge";
import type { BadgeTone } from "./Badge";

/**
 * A list of radio options. Each option can carry a description and a small
 * icon, and is the kind of control a Settings panel uses to pick a voice
 * engine: the label and the description are the bulk of the row, the
 * accent border shows the selection.
 */
export interface RadioOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
  readonly icon?: string | IconifyIcon;
  readonly tone?: BadgeTone;
  readonly detail?: ReactNode;
}

export interface RadioGroupProps<T extends string> {
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly options: readonly RadioOption<T>[];
  readonly name?: string;
  readonly disabled?: boolean;
  readonly className?: string;
}

export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  name,
  disabled = false,
  className
}: RadioGroupProps<T>): JSX.Element {
  return (
    <RadixRadio.Root
      value={value}
      onValueChange={(next) => {
        onChange(next as T);
      }}
      name={name}
      disabled={disabled}
      className={cn("flex flex-col gap-2", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5",
              "transition-colors duration-control",
              active
                ? "border-accent bg-accent-soft"
                : "border-border hover:bg-surface-hover",
              disabled && "cursor-not-allowed opacity-45"
            )}
          >
            <RadixRadio.Item
              value={option.value}
              className={cn(
                "relative mt-0.5 h-4 w-4 shrink-0 rounded-pill border",
                "border-border-strong bg-bg-sunken",
                "data-[state=checked]:border-accent-solid",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              )}
            >
              <RadixRadio.Indicator
                className={cn(
                  "absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-accent-solid",
                  "transition-transform duration-micro data-[state=checked]:scale-100",
                  "scale-0"
                )}
              />
            </RadixRadio.Item>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium text-text">
                {option.icon !== undefined && (
                  <Icon
                    icon={option.icon}
                    className="h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
                {option.label}
                {option.tone !== undefined && <Badge tone={option.tone}>{option.tone}</Badge>}
              </span>
              {option.description !== undefined && (
                <span className="mt-0.5 block text-xs leading-snug text-text-muted">
                  {option.description}
                </span>
              )}
              {option.detail !== undefined && (
                <span className="mt-2 block">{option.detail}</span>
              )}
            </span>
          </label>
        );
      })}
    </RadixRadio.Root>
  );
}
