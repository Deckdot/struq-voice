import { useCallback } from "react";
import { t as translate, type MessageKey, type TranslationParams } from "../../../shared/i18n";
import { useMainStore } from "../store/use-main-store";

/**
 * Read the resolved UI locale and translate against it.
 *
 * The locale itself is owned by the store and kept current by a single
 * settings subscription in Bootstrap. This hook deliberately opens no IPC of
 * its own: it has twenty callers, and one subscription per caller meant twenty
 * settings round trips and twenty listeners for one window-wide value.
 */
export function useTranslation(): {
  t: (key: MessageKey, params?: TranslationParams) => string;
  locale: string;
  dir: "ltr" | "rtl";
} {
  const locale = useMainStore((state) => state.locale);
  const dir = useMainStore((state) => state.dir);

  const t = useCallback(
    (key: MessageKey, params?: TranslationParams) => translate(locale, key, params),
    [locale]
  );

  return { t, locale, dir };
}
