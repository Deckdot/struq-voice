import type { MainWindowApi, OverlayWindowApi } from "../../../shared/api";

type ThemeMode = "system" | "light" | "dark";

const media = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

const resolve = (mode: ThemeMode, systemDark: boolean): "light" | "dark" =>
  mode === "system" ? (systemDark ? "dark" : "light") : mode;

/** Apply a theme synchronously based on the preload's initial theme. Call once before React renders. */
export const applyInitialTheme = (initial: "light" | "dark"): void => {
  document.documentElement.dataset["theme"] = initial;
};

/** Apply a settings-driven theme. System mode listens to matchMedia changes until the user picks a fixed mode. */
export const applyTheme = (mode: ThemeMode, onSystemChange: (dark: boolean) => void): (() => void) => {
  const mq = media();
  const update = (): void => {
    const dark = mq?.matches ?? false;
    document.documentElement.dataset["theme"] = resolve(mode, dark);
    if (mode === "system") onSystemChange(dark);
  };
  update();
  if (mode === "system" && mq !== null) {
    mq.addEventListener("change", update);
    return () => {
      mq.removeEventListener("change", update);
    };
  }
  return () => undefined;
};

export type { ThemeMode };
export const getInitialTheme = (api: MainWindowApi | OverlayWindowApi): "light" | "dark" =>
  api.initialTheme;
