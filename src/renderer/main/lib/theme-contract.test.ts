import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER_ROOT = resolve(__dirname, "../..");
const THEME_SOURCE = readFileSync(resolve(RENDERER_ROOT, "styles/theme.css"), "utf8");

const darkTheme = (): string => {
  const match = THEME_SOURCE.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/);
  return match?.[1] ?? "";
};

describe("dark theme contract", () => {
  it("uses neutral graphite surfaces and terracotta interaction emphasis", () => {
    const source = darkTheme();
    expect(source).toContain("--sv-bg: oklch(0.23 0.006 250)");
    expect(source).toContain("--sv-surface: oklch(0.27 0.007 250)");
    expect(source).toContain("--sv-accent: oklch(0.7 0.13 43)");
  });

  it("keeps every soft semantic state opaque and neutral", () => {
    const source = darkTheme();
    for (const token of ["accent", "ember", "success", "warning", "danger", "info"]) {
      expect(source).toContain(`--sv-${token}-soft: var(--sv-surface-active)`);
    }
    expect(source).not.toMatch(/oklch\([^)]*\//);
  });

  it("does not restore a translucent green listening pulse", () => {
    const overlay = readFileSync(resolve(RENDERER_ROOT, "overlay/overlay.tsx"), "utf8");
    const statusDot = readFileSync(resolve(RENDERER_ROOT, "main/components/ui/StatusDot.tsx"), "utf8");
    expect(`${overlay}\n${statusDot}`).not.toMatch(/bg-success[^"\n]*opacity|bg-success\//);
  });
});
