import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";
import { Rail } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { CommandPalette } from "./components/CommandPalette";
import { UpdateDialog } from "./components/UpdateDialog";
import { Splash } from "./components/Splash";
import { Onboarding } from "./onboarding/Onboarding";
import { useMainStore } from "./store/use-main-store";
import { DictateView } from "./views/DictateView";
import { MeetingsView } from "./views/MeetingsView";
import { HistoryView } from "./views/HistoryView";
import { DictionaryView } from "./views/DictionaryView";
import { ModelsView } from "./views/ModelsView";
import { SettingsView } from "./views/SettingsView";
import type { MainWindowApi } from "../../shared/api";
import type { Settings } from "../../shared/settings";
import { DEFAULT_SETTINGS } from "../../shared/settings";
import { shouldRunOnboarding } from "../../shared/settings";

/**
 * The page turn. Enter slides in from the direction of travel, exit slides
 * out the other side, so going forward reads as moving right and going back
 * as moving left. Enter uses the enter ease, exit the exit ease.
 */
const PAGE_VARIANTS: Variants = {
  initial: (direction: 1 | -1) => ({
    opacity: 0,
    x: direction * 12,
    transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] }
  }),
  animate: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.32, ease: [0.16, 1, 0.3, 1] }
  },
  exit: (direction: 1 | -1) => ({
    opacity: 0,
    x: direction * -8,
    transition: { duration: 0.16, ease: [0.7, 0, 0.84, 0] }
  })
};

const REDUCED_PAGE_VARIANTS: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 }
};

/**
 * The shell settles into the space the curtain vacates.
 *
 * It only fades, and it finishes before the sheet clears the top of the
 * screen. Sliding it as well meant two things moved vertically at once behind
 * a cover that hid most of the travel, so what reached the eye was the shell
 * still drifting after the curtain had gone. One moving object per moment.
 */
const SHELL_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  revealed: {
    opacity: 1,
    transition: { duration: 0.34, delay: 0.1, ease: "linear" }
  }
};

const REDUCED_SHELL_VARIANTS: Variants = {
  hidden: { opacity: 0 },
  revealed: { opacity: 1, transition: { duration: 0.25 } }
};

export function App(): JSX.Element {
  const api = window.struqVoice as MainWindowApi;
  const route = useMainStore((state) => state.route);
  const routeDirection = useMainStore((state) => state.routeDirection);
  const capture = useMainStore((state) => state.capture);
  const shellRevealed = useMainStore((state) => state.shellRevealed);
  const setShellRevealed = useMainStore((state) => state.setShellRevealed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const reducedMotion = useReducedMotion();

  const shellRef = useRef<HTMLDivElement>(null);
  const handleReveal = useCallback(() => {
    setShellRevealed(true);
  }, [setShellRevealed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  // Whether onboarding runs is decided once, from the settings main persists.
  // Re-deciding on every settings change would tear the flow down the moment
  // a step wrote a hotkey.
  useEffect(() => {
    let cancelled = false;
    void api.settings.get().then(({ settings: loaded }) => {
      if (cancelled) return;
      setSettings(loaded);
      setOnboarding(shouldRunOnboarding(loaded));
    });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    return api.settings.onChange(setSettings);
  }, [api]);

  const variants = reducedMotion ? REDUCED_PAGE_VARIANTS : PAGE_VARIANTS;

  return (
    <div className="flex h-full flex-col bg-bg text-text">
      <Splash onReveal={handleReveal} />
      <TitleBar />
      {/* The opacity tween promotes this whole subtree to its own layer, which
          includes the virtualized History list. Clearing the inline opacity
          once it lands drops the layer again, so scrolling is not paying for
          an entrance that finished at boot. */}
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        variants={reducedMotion === true ? REDUCED_SHELL_VARIANTS : SHELL_VARIANTS}
        initial="hidden"
        animate={shellRevealed ? "revealed" : "hidden"}
        onAnimationComplete={(definition) => {
          if (definition !== "revealed") return;
          shellRef.current?.style.removeProperty("opacity");
          shellRef.current?.style.removeProperty("will-change");
        }}
        ref={shellRef}
      >
        {onboarding ? (
          <Onboarding
            settings={settings ?? DEFAULT_SETTINGS}
            capture={capture}
            onFinished={() => {
              setOnboarding(false);
            }}
          />
        ) : (
          <div className="flex min-h-0 flex-1">
            <Rail />
            <main className="relative min-h-0 flex-1 overflow-hidden bg-bg" data-selectable>
              <AnimatePresence mode="wait" initial={false} custom={routeDirection}>
                <motion.div
                  key={route}
                  custom={routeDirection}
                  variants={variants}
                  initial="initial"
                  animate="animate"
                  exit="exit"
                  className="h-full"
                >
                  {route === "dictate" && <DictateView />}
                  {route === "meetings" && <MeetingsView />}
                  {route === "history" && <HistoryView />}
                  {route === "dictionary" && <DictionaryView />}
                  {route === "models" && <ModelsView />}
                  {route === "settings" && <SettingsView />}
                </motion.div>
              </AnimatePresence>
            </main>
          </div>
        )}
      </motion.div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      {/* Not during onboarding: a first run has nothing to update from. */}
      {!onboarding && <UpdateDialog api={api} />}
    </div>
  );
}
