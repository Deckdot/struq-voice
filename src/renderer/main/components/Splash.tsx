import { useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { motion } from "motion/react";
import type { Variants } from "motion/react";
import { useReducedMotion } from "motion/react";
import { BrandMark, BrandMarkAnimated } from "./Brand";

const SPLASH_KEY = "struq.splash.v1";

/** Whether the splash has already played in this window session. */
export const splashSeen = (): boolean => {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(SPLASH_KEY) !== null;
  } catch {
    return false;
  }
};

/** How long the mark holds before the curtain starts. The mark's own bar
 *  stagger finishes at ~900ms, so the hold ends the moment it settles. */
const HOLD_MS = 980;
const REDUCED_HOLD_MS = 600;

/** --ease-panel. Holds, then commits: the cinematic door. */
const CURTAIN_EASE = [0.83, 0, 0.17, 1] as const;
/** --ease-exit. */
const EXIT_EASE = [0.7, 0, 0.84, 0] as const;

const FRONT_SHEET: Variants = {
  held: { y: "0%" },
  lifted: { y: "-100%", transition: { duration: 0.64, ease: CURTAIN_EASE } }
};

const MARK: Variants = {
  held: { opacity: 1 },
  lifted: { opacity: 0, transition: { duration: 0.26, ease: EXIT_EASE } }
};

export interface SplashProps {
  /**
   * Fires the moment the curtain starts to lift, not when it finishes, so
   * the shell rises in the curtain's wake instead of after it.
   */
  readonly onReveal: () => void;
}

/**
 * The first-paint cover. It holds the brand mark while the theme settles,
 * then lifts as a clean curtain and unmounts. Shown once per window
 * session: the sessionStorage gate makes every later mount a no-op.
 */
export function Splash({ onReveal }: SplashProps): JSX.Element | null {
  const reduced = useReducedMotion() === true;
  const [state, setState] = useState<"shown" | "lifting" | "gone">(() =>
    splashSeen() ? "gone" : "shown"
  );

  // The callback is held in a ref so an inline arrow from the caller cannot
  // restart the hold timer on every render.
  const revealRef = useRef(onReveal);
  useEffect(() => {
    revealRef.current = onReveal;
  }, [onReveal]);

  useEffect(() => {
    if (state === "gone") {
      revealRef.current();
      return;
    }
    if (state !== "shown") return;
    try {
      sessionStorage.setItem(SPLASH_KEY, "1");
    } catch {
      // Private mode or a locked-down profile: the splash simply plays again.
    }
    const timer = window.setTimeout(
      () => {
        setState("lifting");
        revealRef.current();
      },
      reduced ? REDUCED_HOLD_MS : HOLD_MS
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [reduced, state]);

  if (state === "gone") return null;

  if (reduced) {
    return (
      <motion.div
        className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg"
        initial={{ opacity: 1 }}
        animate={{ opacity: state === "lifting" ? 0 : 1 }}
        transition={{ duration: 0.3, ease: "linear" }}
        onAnimationComplete={() => {
          if (state === "lifting") setState("gone");
        }}
        aria-hidden="true"
      >
        <BrandMark size={64} className="text-accent" />
      </motion.div>
    );
  }

  return (
    <motion.div
      className="pointer-events-none fixed inset-0 z-50 overflow-hidden"
      initial="held"
      animate={state === "lifting" ? "lifted" : "held"}
      aria-hidden="true"
    >
      <motion.div
        variants={FRONT_SHEET}
        className="absolute inset-0 flex items-center justify-center bg-bg"
        onAnimationComplete={() => {
          if (state === "lifting") setState("gone");
        }}
      >
        <motion.span variants={MARK} className="inline-flex">
          <BrandMarkAnimated size={64} className="text-accent" />
        </motion.span>
      </motion.div>
    </motion.div>
  );
}
