import * as RadixDialog from "@radix-ui/react-dialog";
import type { JSX, ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/cn";

/**
 * A modal dialog with a focus trap, escape-to-dismiss, and a small enter
 * motion. The backdrop is a half-transparent text colour with a 2px blur,
 * used only here because a dialog over arbitrary desktop content is the
 * one place a backdrop is doing real work.
 */
export interface DialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
  readonly footer?: ReactNode;
  readonly size?: "sm" | "md" | "lg";
}

const SIZES: Record<"sm" | "md" | "lg", string> = {
  sm: "w-[24rem] max-w-[calc(100vw-4rem)]",
  md: "w-[30rem] max-w-[calc(100vw-4rem)]",
  lg: "w-[42rem] max-w-[calc(100vw-4rem)]"
};

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md"
}: DialogProps): JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <RadixDialog.Portal forceMount>
            <RadixDialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-50 bg-text/30 backdrop-blur-sm"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16, ease: [0.25, 1, 0.5, 1] }}
              />
            </RadixDialog.Overlay>
            <RadixDialog.Content asChild>
              <motion.div
                role="dialog"
                aria-modal="true"
                initial={{ opacity: 0, scale: 0.97, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 8 }}
                transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                  "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
                  "rounded-xl border border-border bg-surface p-5 text-text shadow-float",
                  SIZES[size]
                )}
              >
                <RadixDialog.Title className="font-display text-xl font-medium text-text">
                  {title}
                </RadixDialog.Title>
                {description !== undefined && (
                  <RadixDialog.Description className="mt-1 text-sm text-text-muted">
                    {description}
                  </RadixDialog.Description>
                )}
                {children !== undefined && <div className="mt-4 flex flex-col gap-3">{children}</div>}
                {footer !== undefined && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
              </motion.div>
            </RadixDialog.Content>
          </RadixDialog.Portal>
        )}
      </AnimatePresence>
    </RadixDialog.Root>
  );
}
