import React, { useEffect } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/urbanist/400.css";
import "@fontsource/urbanist/500.css";
import "@fontsource/urbanist/600.css";
import "@fontsource/urbanist/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "../styles/main.css";
import "./lib/icons";
import { applyInitialTheme, applyTheme } from "./lib/theme";
import { App } from "./App";
import { isRtl, resolveLocale } from "../../shared/i18n";
import { clearFormatCaches } from "../../shared/i18n/format";
import { ROUTE_ORDER, useMainStore } from "./store/use-main-store";
import type { CaptureState } from "../../shared/capture";
import type { MainWindowApi } from "../../shared/api";

function Bootstrap(): JSX.Element {
  useEffect(() => {
    const api = window.struqVoice as MainWindowApi;
    let themeCleanup: (() => void) | null = null;
    const applyFromMode = (mode: "system" | "light" | "dark"): void => {
      themeCleanup?.();
      themeCleanup = applyTheme(mode, () => undefined);
    };

    const unsubscribeCapture = api.onCaptureStateChanged((state: CaptureState) => {
      useMainStore.getState().setCapture(state);
    });

    let cancelled = false;
    void api.getReadiness().then((readiness) => {
      if (!cancelled) useMainStore.getState().setReadiness(readiness);
    });
    const unsubscribeReadiness = api.onReadinessChanged((readiness) => {
      useMainStore.getState().setReadiness(readiness);
    });

    // The one settings subscription for this window. Theme and locale both
    // ride it: useTranslation reads the store rather than opening its own.
    const applyLocale = (setting: string): void => {
      const resolved = setting === "system" ? resolveLocale(navigator.languages) : setting;
      const nextDir = isRtl(resolved) ? "rtl" : "ltr";
      clearFormatCaches();
      useMainStore.getState().setLocale(resolved, nextDir);
      document.documentElement.lang = resolved;
      document.documentElement.dir = nextDir;
    };

    void api.settings.get().then(({ settings }) => {
      if (cancelled) return;
      useMainStore.getState().setThemeMode(settings.theme);
      applyFromMode(settings.theme);
      applyLocale(settings.locale);
    });
    const unsubscribeSettings = api.settings.onChange((settings) => {
      useMainStore.getState().setThemeMode(settings.theme);
      applyFromMode(settings.theme);
      applyLocale(settings.locale);
    });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      const index = Number(event.key) - 1;
      if (index < 0 || index >= ROUTE_ORDER.length) return;
      event.preventDefault();
      const next = ROUTE_ORDER[index];
      if (next !== undefined) useMainStore.getState().setRoute(next);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelled = true;
      unsubscribeCapture();
      unsubscribeReadiness();
      unsubscribeSettings();
      window.removeEventListener("keydown", onKeyDown);
      themeCleanup?.();
    };
  }, []);

  // The theme transition in theme.css is held off until the first shell paint
  // so that a later theme switch cannot flash a stale background.
  useEffect(() => {
    document.documentElement.classList.add("theme-ready");
    document.body.classList.add("theme-ready");
  }, []);

  return <App />;
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root element in main window");
}

applyInitialTheme((window.struqVoice as MainWindowApi).initialTheme);

createRoot(rootElement).render(
  <React.StrictMode>
    <Bootstrap />
  </React.StrictMode>,
);
