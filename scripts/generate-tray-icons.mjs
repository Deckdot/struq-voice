/**
 * Generates the tray icons: resources/tray/{idle,recording,transcribing}.png
 * plus @2x variants.
 *
 * These are the brand mark, not generic geometry. An earlier version drew a
 * ring, a disc and five plain bars, which meant the idle tray icon (the state
 * the app is in almost all the time) was a hollow circle with no relationship
 * to the product. The mark is the identity; the state is carried by colour and
 * by the accent dot, not by inventing a different shape per state.
 *
 * - idle:         the mark in forest ink, accent dot in terracotta.
 * - recording:    the whole mark in terracotta.
 * - transcribing: the mark in deep forest, accent dot muted.
 *
 * Rendered through Chromium from the same SVG master as every other brand
 * asset, so the tray can never drift from the logo again.
 *
 * Run: node scripts/generate-tray-icons.mjs (or pnpm brand:generate, which
 * calls this after the brand assets).
 */

import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "resources", "tray");
const symbolSvg = join(root, "resources", "brand", "struq-symbol.svg");

/** oklch to sRGB hex, matching the token values in theme.css. */
const oklchToHex = (L, C, H) => {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ];
  const channel = (v) => {
    const c = Math.min(1, Math.max(0, v));
    const g = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(g * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${lin.map(channel).join("")}`;
};

// The same token values theme.css uses.
const FOREST = oklchToHex(0.3, 0.025, 150);
const ACCENT = oklchToHex(0.535, 0.12, 45);
const DEEP_FOREST = oklchToHex(0.27, 0.03, 152);
const MUTED = oklchToHex(0.52, 0.018, 150);

/** The mark's true bounding box inside the 512 master viewBox. */
const MARK_BOX = { x: 60, y: 112, w: 336, h: 304 };

/**
 * The tray icon is the app tile, not the bare mark.
 *
 * A transparent forest-ink mark disappears into a dark taskbar, which is the
 * default on Windows 11. Carrying the linen field with it means the icon has
 * its own background and therefore guaranteed contrast on any theme, light or
 * dark, rather than depending on what the user's taskbar happens to be.
 *
 * That is also why the tile stays linen in every state: the state is carried
 * by the mark's colour on top of it, never by the field.
 */
const TILE = "#F6F4EB";
// --color-border-strong, the same hairline the interface uses on linen.
const EDGE = oklchToHex(0.795, 0.014, 140);

const variantSvg = (source, markColor, dotColor) => {
  // The master paints the bars via a <g fill> and the accent dot separately,
  // so recolouring is a matter of substituting those two values.
  const recoloured = source
    .replace('<g fill="#294638">', `<g fill="${markColor}">`)
    .replace('fill="#A65332"', `fill="${dotColor}"`);

  // Fit the mark into a square tile with a margin, centred on the art's own
  // bounding box: the mark is not centred inside its 512 viewBox, so centring
  // the viewBox would sit it high and to the left.
  const size = 512;
  const target = 0.66;
  const scale = (size * target) / Math.max(MARK_BOX.w, MARK_BOX.h);
  const tx = (size - MARK_BOX.w * scale) / 2 - MARK_BOX.x * scale;
  const ty = (size - MARK_BOX.h * scale) / 2 - MARK_BOX.y * scale;

  const inner = recoloured
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title[\s\S]*?<\/title>/, "");

  // rx is 20% of the tile, matching struq-app-icon.svg's 104/512.
  //
  // The hairline edge is what gives the tile a silhouette on a light taskbar,
  // where linen on near-white would otherwise dissolve into the background.
  // Inset by half the stroke so it is not clipped by the viewBox.
  const stroke = size * 0.028;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect x="${stroke / 2}" y="${stroke / 2}" width="${size - stroke}" height="${size - stroke}" rx="${size * 0.203}" fill="${TILE}" stroke="${EDGE}" stroke-width="${stroke}" />
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">${inner}</g>
</svg>`;
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const renderSvg = async (svg, output, width, height) => {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`
  );
  await page.screenshot({ path: output, omitBackground: true });
};

await mkdir(outDir, { recursive: true });
const source = await readFile(symbolSvg, "utf8");

const VARIANTS = [
  // Idle is the product's resting face: the mark exactly as the brand draws it.
  ["idle", FOREST, ACCENT],
  // Recording reads at a glance from the corner of the eye, so the whole mark
  // takes the accent rather than only the dot.
  ["recording", ACCENT, ACCENT],
  // Transcribing is working-but-not-listening: darker, dot stood down.
  ["transcribing", DEEP_FOREST, MUTED]
];

console.log(`Generating tray icons into ${outDir}`);
for (const [name, markColor, dotColor] of VARIANTS) {
  const svg = variantSvg(source, markColor, dotColor);
  // Square, because the tile is square. Windows scales the tray icon into a
  // square slot, and a non-square source would be letterboxed.
  for (const [suffix, size] of [["", 16], ["@2x", 32]]) {
    await renderSvg(svg, join(outDir, `${name}${suffix}.png`), size, size);
  }
  console.log(`  wrote ${name}.png and ${name}@2x.png (${markColor})`);
}

await browser.close();
console.log("Done.");
