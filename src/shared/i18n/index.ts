/**
 * Core i18n module: translate, resolveLocale, RTL detection, and locale metadata.
 * No side effects, no Electron imports. Runs in main, preload, renderer and vitest.
 */

import { en } from "./locales/en";
import { nl } from "./locales/nl";
import { de } from "./locales/de";
import { fr } from "./locales/fr";
import { es } from "./locales/es";
import { it } from "./locales/it";
import { ptBR } from "./locales/pt-BR";
import { pl } from "./locales/pl";

import type { MessageKey, TranslationParams } from "./keys";
import { selectPluralForm, type PluralFormMap } from "./plural";

export type { MessageKey, TranslationParams };

export const RTL_LOCALES = ["ar", "he", "fa", "ur"] as const;
export type RtlLocale = (typeof RTL_LOCALES)[number];

export const isRtl = (locale: string): boolean => {
  const base = locale.split("-")[0]?.toLowerCase() ?? "";
  return (RTL_LOCALES as readonly string[]).includes(base);
};

export const TIER1_LOCALES = ["en", "nl", "de", "fr", "es", "it", "pt-BR", "pl"] as const;
export const TIER2_LOCALES = [
  "sv", "da", "nb", "fi", "uk", "ru", "tr"
] as const;
export const TIER3_LOCALES = [
  "zh-Hans", "zh-Hant", "ja", "ko", "hi", "id", "vi", "ar"
] as const;

export const SUPPORTED_LOCALES = [
  ...TIER1_LOCALES,
  ...TIER2_LOCALES,
  ...TIER3_LOCALES
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number] | "qps-ploc";

export interface LocaleMeta {
  readonly code: SupportedLocale;
  readonly name: string;
  readonly endonym: string;
  readonly dir: "ltr" | "rtl";
  readonly reviewed: boolean;
}

export const LOCALE_META: Record<SupportedLocale, LocaleMeta> = {
  en: { code: "en", name: "English", endonym: "English (UK)", dir: "ltr", reviewed: true },
  nl: { code: "nl", name: "Dutch", endonym: "Nederlands", dir: "ltr", reviewed: true },
  de: { code: "de", name: "German", endonym: "Deutsch", dir: "ltr", reviewed: true },
  fr: { code: "fr", name: "French", endonym: "Français", dir: "ltr", reviewed: true },
  es: { code: "es", name: "Spanish", endonym: "Español", dir: "ltr", reviewed: true },
  it: { code: "it", name: "Italian", endonym: "Italiano", dir: "ltr", reviewed: true },
  "pt-BR": { code: "pt-BR", name: "Portuguese (Brazil)", endonym: "Português (Brasil)", dir: "ltr", reviewed: true },
  pl: { code: "pl", name: "Polish", endonym: "Polski", dir: "ltr", reviewed: true },

  sv: { code: "sv", name: "Swedish", endonym: "Svenska", dir: "ltr", reviewed: true },
  da: { code: "da", name: "Danish", endonym: "Dansk", dir: "ltr", reviewed: true },
  nb: { code: "nb", name: "Norwegian Bokmål", endonym: "Norsk bokmål", dir: "ltr", reviewed: true },
  fi: { code: "fi", name: "Finnish", endonym: "Suomi", dir: "ltr", reviewed: true },
  uk: { code: "uk", name: "Ukrainian", endonym: "Українська", dir: "ltr", reviewed: true },
  ru: { code: "ru", name: "Russian", endonym: "Русский", dir: "ltr", reviewed: true },
  tr: { code: "tr", name: "Turkish", endonym: "Türkçe", dir: "ltr", reviewed: true },

  "zh-Hans": { code: "zh-Hans", name: "Chinese (Simplified)", endonym: "简体中文", dir: "ltr", reviewed: true },
  "zh-Hant": { code: "zh-Hant", name: "Chinese (Traditional)", endonym: "繁體中文", dir: "ltr", reviewed: true },
  ja: { code: "ja", name: "Japanese", endonym: "日本語", dir: "ltr", reviewed: true },
  ko: { code: "ko", name: "Korean", endonym: "한국어", dir: "ltr", reviewed: true },
  hi: { code: "hi", name: "Hindi", endonym: "हिन्दी", dir: "ltr", reviewed: true },
  id: { code: "id", name: "Indonesian", endonym: "Bahasa Indonesia", dir: "ltr", reviewed: true },
  vi: { code: "vi", name: "Vietnamese", endonym: "Tiếng Việt", dir: "ltr", reviewed: true },
  ar: { code: "ar", name: "Arabic", endonym: "العربية", dir: "rtl", reviewed: true },

  "qps-ploc": { code: "qps-ploc", name: "Pseudo-locale", endonym: " [Śéttíñgś ~~~~~]", dir: "ltr", reviewed: true }
};

export const localeMeta = (locale: string): LocaleMeta => {
  const meta = (LOCALE_META as Record<string, LocaleMeta | undefined>)[locale];
  if (meta !== undefined) return meta;
  return LOCALE_META.en;
};

export const formatLocaleLabel = (meta: LocaleMeta): string => {
  if (meta.name === meta.endonym || meta.endonym.startsWith(meta.name)) {
    return meta.endonym;
  }
  return `${meta.name} (${meta.endonym})`;
};

/** Alias mapping table according to specification */
export const normalizeLocaleTag = (tag: string): string => {
  const clean = tag.trim();
  if (clean.length === 0) return "en";

  const lower = clean.toLowerCase();
  const base = lower.split("-")[0] ?? "";

  // Apply alias table
  if (lower === "zh-cn" || lower === "zh-sg" || lower.startsWith("zh-hans")) return "zh-Hans";
  if (lower === "zh-tw" || lower === "zh-hk" || lower === "zh-mo" || lower.startsWith("zh-hant")) return "zh-Hant";
  if (lower === "pt-br") return "pt-BR";
  if (lower === "pt" || lower === "pt-pt" || lower === "pt-ao" || lower === "pt-mz") return "pt-PT";
  if (base === "no" || base === "nn" || base === "nb") return "nb";
  if (lower === "sr-latn" || lower === "sr-me" || lower === "sr-ba") return "sr-Latn";
  if (lower === "sr" || lower === "sr-cyrl") return "sr-Cyrl";
  if (base === "he" || base === "iw") return "he";
  if (base === "id" || base === "in") return "id";
  if (base === "fil" || base === "tl") return "fil";
  if (lower.startsWith("en-") || lower === "en") return "en";

  const parts = clean.split("-");
  if (parts.length === 2) {
    const p0 = parts[0];
    const p1 = parts[1];
    if (p0 !== undefined && p1 !== undefined) {
      return `${p0.toLowerCase()}-${p1.toUpperCase()}`;
    }
  }
  return parts[0]?.toLowerCase() ?? "en";
};

/**
 * Main locale resolution algorithm.
 * Resolves against preferred Windows system languages.
 */
export const resolveLocale = (
  preferred: readonly string[],
  supported: readonly string[] = SUPPORTED_LOCALES
): SupportedLocale => {
  for (const rawTag of preferred) {
    const normalized = normalizeLocaleTag(rawTag);
    if (supported.includes(normalized)) {
      return normalized as SupportedLocale;
    }
    const baseSubtag = normalized.split("-")[0] ?? "";
    if (supported.includes(baseSubtag)) {
      return baseSubtag as SupportedLocale;
    }
  }
  return "en";
};

/**
 * Placeholder interpolation helper. Replaces {name} with param value.
 * Safe against missing placeholders: preserves literal {name} and never throws.
 */
export const interpolate = (template: string, params?: TranslationParams): string => {
  if (params === undefined) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    const val = params[key];
    if (val !== undefined) return String(val);
    return match;
  });
};

/** Accented character map for pseudo-localization */
const ACCENT_MAP: Record<string, string> = {
  a: "á", b: "ḃ", c: "ć", d: "ḋ", e: "é", f: "ḟ", g: "ǵ", h: "ḣ", i: "í",
  j: "ĵ", k: "ḱ", l: "ĺ", m: "ṁ", n: "ñ", o: "ó", p: "ṗ", q: "ʠ", r: "ŕ",
  s: "ś", t: "ṫ", u: "ú", v: "ṽ", w: "ŵ", x: "ẋ", y: "ý", z: "ź",
  A: "Á", B: "Ḃ", C: "Ć", D: "Ḋ", E: "É", F: "Ḟ", G: "Ǵ", H: "Ḣ", I: "Í",
  J: "Ĵ", K: "Ḱ", L: "Ĺ", M: "Ṁ", N: "Ñ", O: "Ó", P: "Ṗ", Q: "Ǫ", R: "Ŕ",
  S: "Ś", T: "Ṫ", U: "Ú", V: "Ṽ", W: "Ŵ", X: "Ẋ", Y: "Ý", Z: "Ź"
};

/**
 * Pseudo-localizer for `qps-ploc`:
 * 1. Accents ASCII letters
 * 2. Expands length by ~40%
 * 3. Wraps in visible brackets `[...]`
 */
export const transformPseudoLocale = (str: string): string => {
  let accented = "";
  for (const ch of str) {
    if (ACCENT_MAP[ch] !== undefined) {
      accented += ACCENT_MAP[ch];
    } else {
      accented += ch;
    }
  }
  const padLen = Math.max(2, Math.ceil(str.length * 0.4));
  const padding = " ~".repeat(Math.ceil(padLen / 2)).slice(0, padLen);
  return `[${accented}${padding}]`;
};

const loadedLocales = new Map<string, Record<string, unknown>>([
  ["en", en],
  ["nl", nl],
  ["de", de],
  ["fr", fr],
  ["es", es],
  ["it", it],
  ["pt-BR", ptBR],
  ["pl", pl]
]);

export const registerLocaleCatalog = (locale: string, catalog: Record<string, unknown>): void => {
  loadedLocales.set(locale, catalog);
};

export const getLoadedCatalog = (locale: string): Record<string, unknown> => {
  return loadedLocales.get(locale) ?? en;
};

/**
 * Central translation lookup function `t()`.
 * Performs key lookup, fallback to English, plural category selection, and parameter interpolation.
 */
export const t = (
  locale: string,
  key: MessageKey,
  params?: TranslationParams
): string => {
  if (locale === "qps-ploc") {
    const rawEn = en[key];
    const valStr =
      typeof rawEn === "string"
        ? rawEn
        : selectPluralForm("en", rawEn, Number(params?.["count"] ?? 0));
    return transformPseudoLocale(interpolate(valStr, params));
  }

  const catalog = getLoadedCatalog(locale);
  const raw: unknown = catalog[key] ?? (en as Record<string, unknown>)[key];

  if (raw === undefined) {
    return key;
  }

  const text =
    typeof raw === "string"
      ? raw
      : selectPluralForm(locale, raw as PluralFormMap, Number(params?.["count"] ?? 0));

  return interpolate(text, params);
};
