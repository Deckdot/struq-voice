import * as Popover from "@radix-ui/react-popover";
import type { ChangeEvent, JSX, ReactNode, SelectHTMLAttributes } from "react";
import { Children, forwardRef, isValidElement, useState } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

export interface SelectOptGroup {
  readonly label: string;
  readonly options: readonly SelectOption[];
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size" | "onChange"> {
  readonly size?: "sm" | "md";
  readonly invalid?: boolean;
  readonly onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  readonly options?: readonly (SelectOption | SelectOptGroup)[];
}

interface ParsedOptionItem {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean | undefined;
}

interface ParsedGroupItem {
  readonly groupLabel: string;
  readonly options: readonly ParsedOptionItem[];
}

type ParsedItem = { type: "option"; data: ParsedOptionItem } | { type: "group"; data: ParsedGroupItem };

const HEIGHTS: Record<"sm" | "md", string> = {
  sm: "h-7 text-xs",
  md: "h-8 text-sm"
};

const parseChildren = (children: ReactNode): ParsedItem[] => {
  const result: ParsedItem[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "option") {
      const props = child.props as { value?: string; children?: ReactNode; disabled?: boolean };
      const val = props.value !== undefined ? props.value : (typeof props.children === "string" || typeof props.children === "number" ? String(props.children) : "");
      const lbl =
        typeof props.children === "string" || typeof props.children === "number"
          ? String(props.children)
          : val;
      result.push({
        type: "option",
        data: { value: val, label: lbl, disabled: props.disabled }
      });
    } else if (child.type === "optgroup") {
      const props = child.props as { label?: string; children?: ReactNode };
      const groupLabel = props.label ?? "";
      const groupOptions: ParsedOptionItem[] = [];
      Children.forEach(props.children, (gChild) => {
        if (!isValidElement(gChild)) return;
        if (gChild.type === "option") {
          const gProps = gChild.props as { value?: string; children?: ReactNode; disabled?: boolean };
          const val = gProps.value !== undefined ? gProps.value : (typeof gProps.children === "string" || typeof gProps.children === "number" ? String(gProps.children) : "");
          const lbl =
            typeof gProps.children === "string" || typeof gProps.children === "number"
              ? String(gProps.children)
              : val;
          groupOptions.push({ value: val, label: lbl, disabled: gProps.disabled });
        }
      });
      result.push({
        type: "group",
        data: { groupLabel, options: groupOptions }
      });
    }
  });
  return result;
};

/**
 * A custom styled Dropdown Select primitive built on Radix Popover.
 * Uses Struq Voice theme tokens (cream porcelain in light mode, graphite in dark mode),
 * custom caret indicator, optgroup headers, and keyboard access.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = "md", invalid = false, disabled = false, className, value, onChange, children, options: rawOptions, ...rest },
  ref
): JSX.Element {
  const [open, setOpen] = useState(false);

  let items: ParsedItem[];
  if (rawOptions !== undefined) {
    items = rawOptions.map((opt): ParsedItem => {
      if ("options" in opt) {
        return {
          type: "group",
          data: { groupLabel: opt.label, options: opt.options }
        };
      }
      return {
        type: "option",
        data: opt
      };
    });
  } else {
    items = parseChildren(children);
  }

  const allOptions: ParsedOptionItem[] = items.flatMap((item) =>
    item.type === "option" ? [item.data] : item.data.options
  );

  const currentValueStr = value !== undefined ? String(value) : "";
  const selectedOption = allOptions.find((opt) => opt.value === currentValueStr) ?? allOptions[0];
  const currentDisplayLabel = selectedOption?.label ?? currentValueStr;

  const handleSelect = (optionValue: string): void => {
    setOpen(false);
    if (onChange !== undefined) {
      const syntheticEvent = {
        target: { value: optionValue, name: rest.name },
        currentTarget: { value: optionValue, name: rest.name }
      } as unknown as ChangeEvent<HTMLSelectElement>;
      onChange(syntheticEvent);
    }
  };

  return (
    <div className="relative inline-block w-full">
      {/* Hidden native select for form/ref compatibility */}
      <select
        ref={ref}
        value={value}
        disabled={disabled}
        aria-hidden="true"
        tabIndex={-1}
        className="pointer-events-none absolute inset-0 opacity-0"
        onChange={onChange}
        {...rest}
      >
        {children}
      </select>

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={rest["aria-label"]}
            className={cn(
              "relative flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border bg-bg-sunken px-3 text-start transition-colors duration-hover",
              "hover:border-border-strong focus-visible:outline-none focus-visible:border-accent",
              open ? "border-accent" : invalid ? "border-danger" : "border-border",
              disabled ? "cursor-not-allowed bg-surface opacity-50" : "hover:bg-surface-hover/50",
              HEIGHTS[size],
              className
            )}
          >
            <span className="truncate text-text font-normal">{currentDisplayLabel}</span>
            <Icon
              icon="ph:caret-down"
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-text-muted transition-transform duration-micro",
                open && "rotate-180 text-accent"
              )}
              aria-hidden="true"
            />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-50 min-w-[var(--radix-popover-trigger-width)] max-h-60 overflow-y-auto rounded-lg border border-border bg-surface p-1 text-text shadow-float outline-none"
          >
            {items.map((item, idx) => {
              if (item.type === "option") {
                const isSelected = item.data.value === currentValueStr;
                return (
                  <button
                    key={`${item.data.value}-${String(idx)}`}
                    type="button"
                    disabled={item.data.disabled}
                    onClick={() => {
                      handleSelect(item.data.value);
                    }}
                    className={cn(
                      "flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-start text-sm transition-colors duration-hover",
                      isSelected
                        ? "bg-accent-soft font-medium text-accent"
                        : "text-text hover:bg-surface-hover hover:text-text",
                      item.data.disabled === true && "cursor-not-allowed opacity-40 hover:bg-transparent"
                    )}
                  >
                    <span className="truncate">{item.data.label}</span>
                    {isSelected && (
                      <Icon icon="ph:check" className="ms-2 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    )}
                  </button>
                );
              }
              return (
                <div key={`${item.data.groupLabel}-${String(idx)}`} className="py-1">
                  <div className="px-2.5 pt-1.5 pb-1 text-2xs font-semibold uppercase tracking-wider text-text-muted select-none">
                    {item.data.groupLabel}
                  </div>
                  {item.data.options.map((gOpt, gIdx) => {
                    const isSelected = gOpt.value === currentValueStr;
                    return (
                      <button
                        key={`${gOpt.value}-${String(gIdx)}`}
                        type="button"
                        disabled={gOpt.disabled}
                        onClick={() => {
                          handleSelect(gOpt.value);
                        }}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 text-start text-sm transition-colors duration-hover ps-4",
                          isSelected
                            ? "bg-accent-soft font-medium text-accent"
                            : "text-text hover:bg-surface-hover hover:text-text",
                          gOpt.disabled === true && "cursor-not-allowed opacity-40 hover:bg-transparent"
                        )}
                      >
                        <span className="truncate">{gOpt.label}</span>
                        {isSelected && (
                          <Icon icon="ph:check" className="ms-2 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
});
