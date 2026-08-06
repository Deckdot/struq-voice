import { forwardRef } from "react";
import type { ChangeEvent, JSX } from "react";
import { TextInput } from "./TextInput";
import type { TextInputProps } from "./TextInput";
import { cn } from "../../lib/cn";

/**
 * A number input that right-aligns its digits and uses tabular figures so
 * the field does not twitch while the user is editing. An optional unit
 * suffix (e.g. "ms", "%") sits on the trailing edge inside the same field.
 *
 * Unlike a plain text input, the onChange here delivers a parsed number
 * so callers do not have to repeat `Number(event.target.value)`.
 */
export interface NumberInputProps extends Omit<TextInputProps, "leadingIcon" | "trailingIcon" | "type" | "onChange"> {
  readonly unit?: string;
  readonly min?: number;
  readonly max?: number;
  readonly onChange?: (value: number) => void;
}

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(function NumberInput(
  { unit, className, onChange, min, max, ...rest },
  ref
): JSX.Element {
  return (
    <TextInput
      ref={ref}
      type="number"
      min={min}
      max={max}
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
      onChange={
        onChange === undefined
          ? undefined
          : (event: ChangeEvent<HTMLInputElement>) => {
              const raw = event.target.value;
              if (raw === "" || raw === "-") return;
              const value = Number(raw);
              if (!Number.isFinite(value)) return;
              if (min !== undefined && value < min) return;
              if (max !== undefined && value > max) return;
              onChange(value);
            }
      }
      {...rest}
    />
  );
});
