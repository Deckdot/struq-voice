import type { JSX } from "react";
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
}

export function SearchInput({
  value,
  onChange,
  onClear,
  placeholder = "Search",
  clearLabel = "Clear search",
  id,
  className
}: SearchInputProps): JSX.Element {
  return (
    <TextInput
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
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
