import * as RadixPopover from "@radix-ui/react-popover";
import type { JSX, ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/cn";

/**
 * A small panel anchored to a trigger. The popover has a subtle scale and
 * rise so it never just appears; it settles into place. Use for menus and
 * per-row actions that have a few options.
 */
export interface PopoverProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly anchor: ReactNode;
  readonly align?: "start" | "center" | "end";
  readonly side?: "top" | "bottom" | "left" | "right";
  readonly children: ReactNode;
  readonly className?: string;
}

export function Popover({
  open,
  onOpenChange,
  anchor,
  align = "start",
  side = "bottom",
  children,
  className
}: PopoverProps): JSX.Element {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{anchor}</RadixPopover.Trigger>
      <AnimatePresence>
        {open && (
          <RadixPopover.Portal forceMount>
            <RadixPopover.Content
              side={side}
              align={align}
              sideOffset={6}
              asChild
            >
              <motion.div
                initial={{ opacity: 0, scale: 0.98, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, y: 4 }}
                transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
                className={cn(
                  "z-50 rounded-xl border border-border bg-surface p-3 text-text shadow-lift",
                  className
                )}
              >
                {children}
              </motion.div>
            </RadixPopover.Content>
          </RadixPopover.Portal>
        )}
      </AnimatePresence>
    </RadixPopover.Root>
  );
}
