import type { JSX, KeyboardEvent } from "react";
import { TextInput } from "./TextInput";
import { cn } from "../../lib/cn";

/**
 * A text field with a magnifier at the leading edge and an X to clear when
 * there is something to clear. Used by History search and the command palette.
 */
export interface SearchInputProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onClear?: () => void;
  readonly placeholder?: string;
  readonly clearLabel?: string;
  readonly id?: string;
  readonly className?: string;
  readonly autoFocus?: boolean;
  readonly onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = "Search",
  clearLabel = "Clear search",
  id,
  className,
  autoFocus,
  onKeyDown
}: SearchInputProps): JSX.Element {
  return (
    <TextInput
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      {...(autoFocus !== undefined ? { autoFocus } : {})}
      {...(onKeyDown !== undefined ? { onKeyDown } : {})}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      leadingIcon="ph:magnifying-glass"
      {...(value.length > 0
        ? {
            trailingIcon: "ph:x",
            trailingLabel: clearLabel,
            onTrailingClick: () => {
              onChange("");
              onClear?.();
            }
          }
        : {})}
      containerClassName={cn("max-w-md", className)}
    />
  );
}
