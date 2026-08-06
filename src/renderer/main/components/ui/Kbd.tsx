import type { JSX } from "react";
import { formatAccelerator } from "../../../../shared/hotkeys";
import { cn } from "../../lib/cn";

/**
 * A keycap. The accelerator string is in Electron's portable format
 * ("CommandOrControl+Shift+Space") and is shown in the form a Windows
 * user recognises, so the label always matches the key they will press.
 */
export interface KbdProps {
  readonly accelerator: string;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

export function Kbd({ accelerator, size = "sm", className }: KbdProps): JSX.Element {
  return (
    <kbd
      className={cn(
        "inline-flex select-none items-center rounded-sm border border-border bg-bg-sunken font-sans font-semibold tabular-nums text-text",
        size === "sm" ? "h-5 px-1.5 text-2xs" : "h-6 px-2 text-xs",
        className
      )}
    >
      {formatAccelerator(accelerator)}
    </kbd>
  );
}
