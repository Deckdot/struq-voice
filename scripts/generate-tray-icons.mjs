/**
 * Generates the tray icons: resources/tray/{idle,recording,transcribing}.png
 * plus @2x variants and animated recording frame sequences from blocks-wave.svg.
 *
 * - idle:         the mark in forest ink, accent dot in terracotta.
 * - recording:    animated block wave sequence in terracotta accent (#A65332).
 * - transcribing: the mark in deep forest, accent dot muted.
 *
 * Run: node scripts/generate-tray-icons.mjs (or pnpm brand:generate).
 */

import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "resources", "tray");
const symbolSvg = join(root, "resources", "brand", "struq-symbol.svg");
const blocksWaveSvg = join(root, "resources", "brand", "blocks-wave.svg");

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

// Token values
const FOREST = oklchToHex(0.3, 0.025, 150);
const ACCENT = oklchToHex(0.535, 0.12, 45); // Terracotta accent #A65332
const DEEP_FOREST = oklchToHex(0.27, 0.03, 152);
const MUTED = oklchToHex(0.52, 0.018, 150);

const MARK_BOX = { x: 60, y: 112, w: 336, h: 304 };

const TILE = "#F6F4EB";
const EDGE = oklchToHex(0.795, 0.014, 140);

const variantSvg = (source, markColor, dotColor) => {
  const recoloured = source
    .replace('<g fill="#294638">', `<g fill="${markColor}">`)
    .replace('fill="#A65332"', `fill="${dotColor}"`);

  const size = 512;
  const target = 0.66;
  const scale = (size * target) / Math.max(MARK_BOX.w, MARK_BOX.h);
  const tx = (size - MARK_BOX.w * scale) / 2 - MARK_BOX.x * scale;
  const ty = (size - MARK_BOX.h * scale) / 2 - MARK_BOX.y * scale;

  const inner = recoloured
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title[\s\S]*?<\/title>/, "");

  const stroke = size * 0.028;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect x="${stroke / 2}" y="${stroke / 2}" width="${size - stroke}" height="${size - stroke}" rx="${size * 0.203}" fill="${TILE}" stroke="${EDGE}" stroke-width="${stroke}" />
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})">${inner}</g>
</svg>`;
};

const variantBlocksWaveSvg = (blocksWaveSource, color) => {
  const size = 512;
  const target = 0.58;
  const box = { w: 24, h: 24 };
  const scale = (size * target) / Math.max(box.w, box.h);
  const tx = (size - box.w * scale) / 2;
  const ty = (size - box.h * scale) / 2;

  const stroke = size * 0.028;
  const inner = blocksWaveSource
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <rect x="${stroke / 2}" y="${stroke / 2}" width="${size - stroke}" height="${size - stroke}" rx="${size * 0.203}" fill="${TILE}" stroke="${EDGE}" stroke-width="${stroke}" />
  <g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${scale.toFixed(4)})" fill="${color}">${inner}</g>
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
const blocksSource = await readFile(blocksWaveSvg, "utf8");

// Generate standard static variants: idle and transcribing
const STATIC_VARIANTS = [
  ["idle", FOREST, ACCENT],
  ["transcribing", DEEP_FOREST, MUTED]
];

console.log(`Generating tray icons into ${outDir}`);
for (const [name, markColor, dotColor] of STATIC_VARIANTS) {
  const svg = variantSvg(source, markColor, dotColor);
  for (const [suffix, size] of [["", 16], ["@2x", 32]]) {
    await renderSvg(svg, join(outDir, `${name}${suffix}.png`), size, size);
  }
  console.log(`  wrote ${name}.png and ${name}@2x.png (${markColor})`);
}

// Generate static recording fallback
const staticRecordingSvg = variantSvg(source, ACCENT, ACCENT);
for (const [suffix, size] of [["", 16], ["@2x", 32]]) {
  await renderSvg(staticRecordingSvg, join(outDir, `recording${suffix}.png`), size, size);
}

// Generate animated recording frame sequence from blocks-wave.svg with terracotta ACCENT
const FRAME_COUNT = 10;
const DURATION_SEC = 0.9;
const animatedRecordingSvg = variantBlocksWaveSvg(blocksSource, ACCENT);

console.log(`Generating ${FRAME_COUNT} animated recording frame icons (terracotta ${ACCENT})...`);
for (const [suffix, size] of [["", 16], ["@2x", 32]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${animatedRecordingSvg}`
  );
  for (let f = 0; f < FRAME_COUNT; f++) {
    const timeSec = (f / FRAME_COUNT) * DURATION_SEC;
    await page.evaluate((t) => {
      const doc = globalThis.document;
      if (!doc) return;
      const svgEl = doc.querySelector("svg");
      if (svgEl && typeof svgEl.setCurrentTime === "function") {
        svgEl.setCurrentTime(t);
      }
    }, timeSec);
    const framePath = join(outDir, `recording-frame-${f}${suffix}.png`);
    await page.screenshot({ path: framePath, omitBackground: true });
  }
}
console.log(`  wrote recording-frame-0..${FRAME_COUNT - 1} (.png and @2x.png)`);

await browser.close();
console.log("Done.");
