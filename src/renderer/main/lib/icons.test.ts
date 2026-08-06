import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import collection from "../../assets/icons/ph.json";

/**
 * The renderer runs under a CSP that blocks Iconify's HTTP API, so an icon
 * name that is not in the vendored subset does not fall back: it renders
 * nothing, silently. This walks the real source tree and fails on any `ph:`
 * name that was never vendored, which is cheaper than noticing a blank square
 * in a screenshot.
 */

const RENDERER_ROOT = resolve(__dirname, "../..");

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
};

const referencedIcons = (): Map<string, string[]> => {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles(RENDERER_ROOT)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/["'`]ph:([a-z0-9-]+)["'`]/g)) {
      const name = match[1];
      if (name === undefined) continue;
      const where = found.get(name) ?? [];
      where.push(file.slice(RENDERER_ROOT.length + 1));
      found.set(name, where);
    }
  }
  return found;
};

describe("vendored phosphor icons", () => {
  it("declares the 256x256 grid the icon bodies are drawn on", () => {
    // Without these the SVG gets a 16x16 viewBox and every glyph renders far
    // outside the frame: right size, right colour, nothing visible.
    expect(collection.width).toBe(256);
    expect(collection.height).toBe(256);
  });

  it("contains every ph: icon referenced in the renderer", () => {
    const available = new Set(Object.keys(collection.icons));
    const missing = [...referencedIcons().entries()]
      .filter(([name]) => !available.has(name))
      .map(([name, files]) => `ph:${name} (${[...new Set(files)].join(", ")})`);

    expect(missing).toEqual([]);
  });
});
