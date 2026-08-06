import { describe, expect, it } from "vitest";
import { en } from "./locales/en";
import { isRtl, resolveLocale, t, interpolate, getLoadedCatalog } from "./index";
import { selectPluralForm } from "./plural";

describe("i18n module", () => {
  it("resolves locales correctly based on preferred languages list", () => {
    expect(resolveLocale(["nl-NL", "en-GB"])).toBe("nl");
    expect(resolveLocale(["zh-TW"])).toBe("zh-Hant");
    expect(resolveLocale(["zh-CN"])).toBe("zh-Hans");
    expect(resolveLocale(["iw-IL"])).toBe("he");
    expect(resolveLocale(["pt-BR"])).toBe("pt-BR");
    expect(resolveLocale(["xx-YY"])).toBe("en");
    expect(resolveLocale([])).toBe("en");
  });

  it("detects RTL locales correctly", () => {
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("he")).toBe(true);
    expect(isRtl("fa")).toBe(true);
    expect(isRtl("ur")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(isRtl("nl")).toBe(false);
    expect(isRtl("zh-Hans")).toBe(false);
  });

  it("interpolates parameters safely without throwing on missing keys", () => {
    expect(interpolate("Hello {name}", { name: "Alice" })).toBe("Hello Alice");
    expect(interpolate("Count is {count}", { count: 5 })).toBe("Count is 5");
    expect(interpolate("Missing {foo}")).toBe("Missing {foo}");
  });

  it("translates keys from English catalog", () => {
    expect(t("en", "app.name")).toBe("Struq Voice");
    expect(t("en", "history.count", { count: 3 })).toBe("3 transcripts");
    expect(t("en", "history.count", { count: 1 })).toBe("1 transcript");
  });

  it("selects plural forms correctly", () => {
    const forms = { one: "{count} item", other: "{count} items" };
    expect(selectPluralForm("en", forms, 1)).toBe("{count} item");
    expect(selectPluralForm("en", forms, 2)).toBe("{count} items");
    expect(selectPluralForm("en", forms, 0)).toBe("{count} items");
  });

  it("contains zero em dashes (U+2013, U+2014, U+2015) in English catalog", () => {
    const rawJson = JSON.stringify(en);
    expect(rawJson).not.toMatch(/[\u2013\u2014\u2015]/);
  });

  it("verifies key parity across all loaded locales (all locale keys are a subset of English)", () => {
    const enKeys = new Set(Object.keys(en));
    const localesToTest = ["nl", "de", "fr", "es", "it", "pt-BR", "pl"];

    for (const loc of localesToTest) {
      const catalog = getLoadedCatalog(loc);
      for (const key of Object.keys(catalog)) {
        expect(enKeys.has(key), `Key "${key}" in locale "${loc}" is missing from English catalog`).toBe(true);
      }
    }
  });

  it("verifies placeholder parity between English and other locales", () => {
    const getPlaceholders = (val: unknown): Set<string> => {
      const set = new Set<string>();
      const str = typeof val === "string" ? val : JSON.stringify(val);
      const matches = str.match(/\{([a-zA-Z0-9_]+)\}/g);
      if (matches !== null) {
        for (const m of matches) set.add(m);
      }
      return set;
    };

    const localesToTest = ["nl", "de", "fr", "es", "it", "pt-BR", "pl"];
    for (const loc of localesToTest) {
      const catalog = getLoadedCatalog(loc);
      for (const [key, val] of Object.entries(catalog)) {
        const enVal = (en as Record<string, unknown>)[key];
        if (enVal !== undefined) {
          const enPlaceholders = getPlaceholders(enVal);
          const locPlaceholders = getPlaceholders(val);
          expect(locPlaceholders, `Placeholder mismatch in "${key}" for locale "${loc}"`).toEqual(enPlaceholders);
        }
      }
    }
  });

  it("transforms strings properly in pseudo-locale qps-ploc", () => {
    const res = t("qps-ploc", "app.name");
    expect(res.startsWith("[")).toBe(true);
    expect(res.endsWith("]")).toBe(true);
    expect(res.length).toBeGreaterThan("Struq Voice".length);
  });
});
