import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { JSX, ReactElement, ReactNode } from "react";
import { cn } from "../../lib/cn";

/**
 * A brief popper that explains a control without a label. No arrow: cleaner
 * at this density, and the position of the control itself tells the eye
 * what the tip refers to. Renders inside a portal so a parent overflow
 * cannot clip it.
 */
export interface TooltipProps {
  readonly label: string;
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly delayMs?: number;
  readonly children: ReactElement;
}

export function Tooltip({
  label,
  side = "top",
  delayMs = 300,
  children
}: TooltipProps): JSX.Element {
  return (
    <RadixTooltip.Provider delayDuration={delayMs}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            side={side}
            sideOffset={6}
            className={cn(
              "z-50 select-none rounded-sm bg-text px-1.5 py-0.5 text-2xs font-medium text-text-inverse shadow-lift",
              "data-[state=delayed-open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0"
            )}
          >
            {label}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}

/** Provider wrapper so any deeper tree can render Tooltips without nesting Providers. */
export interface TooltipProviderProps {
  readonly children: ReactNode;
  readonly delayMs?: number;
}

export function TooltipProvider({ children, delayMs = 300 }: TooltipProviderProps): JSX.Element {
  return (
    <RadixTooltip.Provider delayDuration={delayMs}>{children}</RadixTooltip.Provider>
  );
}
