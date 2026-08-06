import * as RadixSwitch from "@radix-ui/react-switch";
import type { JSX } from "react";
import { cn } from "../../lib/cn";

/**
 * A small toggle built on Radix. The track is 36x20, the thumb 16x16, the
 * motion is weighted via the micro easing so a flip reads as deliberate.
 */
export interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly className?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  className
}: SwitchProps): JSX.Element {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      id={id}
      className={cn(
        "relative h-5 w-9 shrink-0 cursor-pointer rounded-pill border border-transparent",
        "transition-colors duration-hover",
        "bg-border data-[state=checked]:bg-accent-solid",
        "disabled:cursor-not-allowed disabled:bg-bg-sunken",
        className
      )}
    >
      <RadixSwitch.Thumb
        className={cn(
          "block h-4 w-4 translate-x-0.5 rounded-pill bg-bg",
          "transition-transform duration-hover",
          "data-[state=checked]:translate-x-[18px]",
          "shadow-sm"
        )}
      />
      {label !== undefined && <span className="sr-only">{label}</span>}
    </RadixSwitch.Root>
  );
}
