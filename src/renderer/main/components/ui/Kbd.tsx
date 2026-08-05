import type { JSX } from "react";
import { cn } from "../../lib/cn";
import { formatAccelerator } from "../../../../shared/hotkeys";

/**
 * A keycap. Accelerators are stored in Electron's format
 * ("CommandOrControl+Space") and shown in the form a Windows user recognises,
 * so the label always matches the key they will actually press.
 */
export interface KbdProps {
  /** Accelerator string, formatted for display before rendering. */
  readonly accelerator: string;
  readonly size?: "sm" | "md";
  readonly className?: string;
}

export function Kbd({ accelerator, size = "sm", className }: KbdProps): JSX.Element {
  return (
    <kbd
      className={cn(
        "inline-flex items-center rounded-sm border border-border-strong bg-bg-sunken font-mono text-text",
        size === "sm" ? "px-1.5 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
        className
      )}
    >
      {formatAccelerator(accelerator)}
    </kbd>
  );
}
