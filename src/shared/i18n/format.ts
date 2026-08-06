/**
 * Locale-aware Intl.DateTimeFormat, NumberFormat, and RelativeTimeFormat factories
 * with cache to avoid per-render object construction overhead.
 */

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();
const relativeTimeCache = new Map<string, Intl.RelativeTimeFormat>();

export const dateFormat = (
  locale: string,
  options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat => {
  const key = `${locale}|${options !== undefined ? JSON.stringify(options) : "default"}`;
  let formatter = dateTimeCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateTimeCache.set(key, formatter);
  }
  return formatter;
};

export const numberFormat = (
  locale: string,
  options?: Intl.NumberFormatOptions
): Intl.NumberFormat => {
  const key = `${locale}|${options !== undefined ? JSON.stringify(options) : "default"}`;
  let formatter = numberFormatCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(key, formatter);
  }
  return formatter;
};

export const relativeTimeFormat = (
  locale: string,
  options?: Intl.RelativeTimeFormatOptions
): Intl.RelativeTimeFormat => {
  const key = `${locale}|${options !== undefined ? JSON.stringify(options) : "default"}`;
  let formatter = relativeTimeCache.get(key);
  if (formatter === undefined) {
    formatter = new Intl.RelativeTimeFormat(locale, options);
    relativeTimeCache.set(key, formatter);
  }
  return formatter;
};

/** Clear cached formatters on locale switch */
export const clearFormatCaches = (): void => {
  dateTimeCache.clear();
  numberFormatCache.clear();
  relativeTimeCache.clear();
};
