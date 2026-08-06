import { forwardRef } from "react";
import type { JSX } from "react";
import { TextInput } from "./TextInput";
import type { TextInputProps } from "./TextInput";
import { cn } from "../../lib/cn";

/**
 * A number input that right-aligns its digits and uses tabular figures so
 * the field does not twitch while the user is editing. An optional unit
 * suffix (e.g. "ms", "%") sits on the trailing edge inside the same field.
 */
export interface NumberInputProps extends Omit<TextInputProps, "leadingIcon" | "trailingIcon" | "type"> {
  readonly unit?: string;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { unit, className, ...rest },
  ref
): JSX.Element {
  return (
    <TextInput
      ref={ref}
      type="number"
      className={cn(
        "text-right font-semibold tabular-nums",
        unit !== undefined ? "pr-10" : undefined,
        className
      )}
      trailingSlot={
        unit !== undefined ? (
          <span className="text-xs font-normal text-text-muted">{unit}</span>
        ) : undefined
      }
      {...rest}
    />
  );
});
