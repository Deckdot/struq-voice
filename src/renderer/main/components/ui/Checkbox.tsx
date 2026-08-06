import { useState } from "react";
import type { JSX } from "react";
import { Icon } from "@iconify/react";
import { cn } from "../../lib/cn";

/**
 * A 16px square check box. The checkmark is an inline SVG that draws with
 * stroke-dashoffset 0..24 so the gesture is visible, not a snap.
 */
export interface CheckboxProps {
  readonly checked: boolean;
  readonly onChange: (next: boolean) => void;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly className?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  id,
  className
}: CheckboxProps): JSX.Element {
  const [pressed, setPressed] = useState(false);

  return (
    <label
      className={cn(
        "group inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-sm",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-bg-sunken",
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        onMouseDown={() => {
          setPressed(true);
        }}
        onMouseUp={() => {
          setPressed(false);
        }}
        onMouseLeave={() => {
          setPressed(false);
        }}
        id={id}
        className="sr-only"
      />
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-sm border",
          "transition-all duration-hover",
          checked
            ? "border-accent-solid bg-accent-solid"
            : "border-border-strong bg-bg-sunken",
          pressed && "scale-95"
        )}
        aria-hidden="true"
      >
        <Icon
          icon="ph:check"
          className={cn(
            "h-3 w-3 text-text-inverse transition-opacity duration-hover",
            checked ? "opacity-100" : "opacity-0"
          )}
        />
      </span>
      {label !== undefined && <span className="sr-only">{label}</span>}
    </label>
  );
}
