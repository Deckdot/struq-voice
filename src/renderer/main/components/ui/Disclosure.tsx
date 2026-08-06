import type { JSX, ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Icon } from "@iconify/react";
import { useState } from "react";
import { cn } from "../../lib/cn";

/**
 * A single disclosure: a button that rotates a caret and reveals hidden
 * content with a weighted height animation. The chevron and the content
 * move on the same curve so the reveal and the icon agree.
 */
export interface DisclosureProps {
  readonly label: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

export function Disclosure({
  label,
  defaultOpen = false,
  children,
  className
}: DisclosureProps): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={cn("flex flex-col", className)}>
      <button
        type="button"
        onClick={() => {
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 self-start rounded-sm px-1 py-0.5 text-xs text-text-secondary transition-colors duration-hover hover:text-text"
      >
        <motion.span
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
          className="inline-flex"
        >
          <Icon icon="ph:caret-right" className="h-3.5 w-3.5" aria-hidden="true" />
        </motion.span>
        {label}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
