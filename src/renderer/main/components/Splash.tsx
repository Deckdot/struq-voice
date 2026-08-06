import { useEffect, useState } from "react";
import type { JSX } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BrandMark, BrandMarkAnimated } from "./Brand";

/**
 * The first-paint overlay. It covers the shell from the first frame while the
 * theme settles, then fades and unmounts. Shown once per window session: the
 * sessionStorage gate makes every later mount a no-op.
 */
export function Splash(): JSX.Element | null {
  const reduced = useReducedMotion() === true;
  const [state, setState] = useState<"shown" | "hidden" | "gated">(() =>
    typeof sessionStorage !== "undefined" && sessionStorage.getItem("struq.splash.v1") !== null
      ? "gated"
      : "shown"
  );

  useEffect(() => {
    if (state !== "shown") return;
    sessionStorage.setItem("struq.splash.v1", "1");
    const timer = setTimeout(() => {
      setState("hidden");
    }, reduced ? 620 : 800);
    return () => {
      clearTimeout(timer);
    };
  }, [reduced, state]);

  if (state === "gated") return null;

  return (
    <AnimatePresence>
      {state === "shown" && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-bg"
          initial={{ opacity: 1 }}
          animate={reduced ? { opacity: [0, 1, 1, 0] } : { opacity: 0 }}
          transition={
            reduced
              ? { duration: 0.6, times: [0, 0.42, 0.5, 1], ease: "easeInOut" }
              : { delay: 0.6, duration: 0.18, ease: [0.7, 0, 0.84, 0] }
          }
          exit={{ opacity: 0 }}
        >
          {reduced ? (
            <BrandMark size={64} className="text-accent" />
          ) : (
            <BrandMarkAnimated size={64} className="text-accent" />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
