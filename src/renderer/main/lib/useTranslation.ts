import { useEffect, useState } from "react";
import type { MainWindowApi } from "../../../shared/api";
import { isRtl, resolveLocale, t as translate, type MessageKey, type TranslationParams } from "../../../shared/i18n";
import { clearFormatCaches } from "../../../shared/i18n/format";

export function useTranslation(): {
  t: (key: MessageKey, params?: TranslationParams) => string;
  locale: string;
  dir: "ltr" | "rtl";
} {
  const api = window.struqVoice as MainWindowApi;
  const initialLocale = api.initialLocale;
  const initialDir = api.initialDir;

  const [locale, setLocale] = useState<string>(initialLocale);
  const [dir, setDir] = useState<"ltr" | "rtl">(initialDir);

  useEffect(() => {
    void api.settings.get().then(({ settings }) => {
      const resolved =
        settings.locale === "system"
          ? resolveLocale(navigator.languages)
          : settings.locale;
      const nextDir = isRtl(resolved) ? "rtl" : "ltr";
      setLocale(resolved);
      setDir(nextDir);
      document.documentElement.lang = resolved;
      document.documentElement.dir = nextDir;
    });

    return api.settings.onChange((settings) => {
      const resolved =
        settings.locale === "system"
          ? resolveLocale(navigator.languages)
          : settings.locale;
      const nextDir = isRtl(resolved) ? "rtl" : "ltr";
      clearFormatCaches();
      setLocale(resolved);
      setDir(nextDir);
      document.documentElement.lang = resolved;
      document.documentElement.dir = nextDir;
    });
  }, [api]);

  return {
    t: (key: MessageKey, params?: TranslationParams) => translate(locale, key, params),
    locale,
    dir
  };
}
