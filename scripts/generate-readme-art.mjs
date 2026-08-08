#!/usr/bin/env node
/**
 * Renders the README banner art in docs/images. Everything here is drawn from
 * the Evergreen and Ember tokens and the product typefaces, so the artwork
 * and the interface cannot drift apart.
 *
 * Usage: pnpm docs:art
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "images");
const fontDir = join(root, "node_modules", "@fontsource");

const dataUrl = async (path) =>
  `data:font/woff2;base64,${(await readFile(path)).toString("base64")}`;

const display = await dataUrl(
  join(fontDir, "urbanist", "files", "urbanist-latin-400-normal.woff2")
);
const sans400 = await dataUrl(
  join(fontDir, "plus-jakarta-sans", "files", "plus-jakarta-sans-latin-400-normal.woff2")
);
const sans500 = await dataUrl(
  join(fontDir, "plus-jakarta-sans", "files", "plus-jakarta-sans-latin-500-normal.woff2")
);

const tokens = `
  --bg: oklch(0.967 0.012 95);
  --surface: oklch(0.985 0.008 95);
  --sunken: oklch(0.942 0.014 95);
  --text: oklch(0.3 0.025 150);
  --text-secondary: oklch(0.44 0.02 150);
  --text-muted: oklch(0.52 0.018 150);
  --border: oklch(0.885 0.01 130);
  --accent: oklch(0.58 0.12 45);
  --forest: oklch(0.27 0.03 152);
`;

const fonts = `
  @font-face { font-family: "Urbanist"; src: url(${display}) format("woff2"); font-weight: 400; }
  @font-face { font-family: "Plus Jakarta Sans"; src: url(${sans400}) format("woff2"); font-weight: 400; }
  @font-face { font-family: "Plus Jakarta Sans"; src: url(${sans500}) format("woff2"); font-weight: 500; }
`;

/** The brand mark: five bars rising to a stop, then the terracotta dot. */
const mark = (scale = 1) => `
  <svg viewBox="0 0 512 512" width="${72 * scale}" height="${72 * scale}" aria-hidden="true">
    <g fill="var(--forest)">
      <circle cx="76" cy="264" r="16" />
      <rect x="116" y="222" width="32" height="84" rx="16" />
      <rect x="178" y="190" width="32" height="148" rx="16" />
      <rect x="240" y="158" width="32" height="212" rx="16" />
      <rect x="302" y="112" width="36" height="304" rx="18" />
      <path d="M336 244c10 3 15 11 22 20-7 9-12 17-22 20z" />
    </g>
    <circle cx="376" cy="264" r="20" fill="var(--accent)" />
  </svg>`;

/** The same motif at banner scale: 44 bars reading as a spoken sentence. */
const waveform = () => {
  const heights = [
    8, 14, 26, 44, 30, 18, 52, 74, 96, 64, 40, 22, 34, 58, 88, 120, 96, 70, 44, 26, 16, 30,
    52, 86, 132, 104, 76, 48, 28, 18, 36, 64, 92, 68, 42, 24, 14, 28, 46, 34, 20, 12, 8, 6
  ];
  return heights
    .map((height, index) => {
      const accent = index === heights.length - 1;
      return `<span style="height:${height}px;background:${
        accent ? "var(--accent)" : "var(--forest)"
      };opacity:${accent ? 1 : 0.14 + (height / 132) * 0.72}"></span>`;
    })
    .join("");
};

const hero = `
<style>
  ${fonts}
  :root { ${tokens} }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1600px; height: 520px; background: var(--bg);
    font-family: "Plus Jakarta Sans", sans-serif; color: var(--text);
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 72px 88px 0;
    position: relative; overflow: hidden;
  }
  .top { display: flex; align-items: flex-start; justify-content: space-between; gap: 64px; }
  .lockup { display: flex; align-items: center; gap: 20px; }
  .wordmark { font-family: "Urbanist", sans-serif; font-size: 92px; line-height: 1; letter-spacing: -0.02em; }
  .tagline { margin-top: 28px; font-size: 27px; line-height: 1.45; color: var(--text-secondary); max-width: 720px; }
  .tagline b { font-weight: 500; color: var(--text); }
  .keys { margin-top: 34px; display: flex; align-items: center; gap: 14px; }
  .kbd {
    font-family: "Plus Jakarta Sans", sans-serif; font-size: 20px; color: var(--text);
    background: var(--sunken); border: 1px solid var(--border); border-radius: 8px;
    padding: 10px 16px;
  }
  .arrow { color: var(--text-muted); font-size: 20px; }
  .step { font-size: 20px; color: var(--text-muted); }
  .facts { display: flex; gap: 0; align-items: stretch; border-top: 1px solid var(--border); margin-top: 56px; }
  .fact { flex: 1; padding: 24px 32px 30px 0; }
  .fact dt { font-family: "Plus Jakarta Sans", sans-serif; font-size: 15px; letter-spacing: 0.06em;
             text-transform: uppercase; color: var(--text-muted); }
  .fact dd { margin-top: 8px; font-size: 21px; color: var(--text); }
  .wave { display: flex; align-items: center; gap: 5px; height: 132px; padding-top: 18px; }
  .wave span { width: 7px; border-radius: 4px; display: block; }
</style>
<div class="top">
  <div>
    <div class="lockup">${mark(1)}<span class="wordmark">Struq Voice</span></div>
    <p class="tagline">
      <b>Hold a key anywhere in Windows.</b> Speak, release, and the transcript is
      already in the field you were typing in.
    </p>
    <div class="keys">
      <span class="kbd">Ctrl + Space</span>
      <span class="arrow">&rarr;</span>
      <span class="step">speak</span>
      <span class="arrow">&rarr;</span>
      <span class="step">release</span>
      <span class="arrow">&rarr;</span>
      <span class="step">pasted</span>
    </div>
  </div>
  <div class="wave">${waveform()}</div>
</div>
<dl class="facts">
  <div class="fact"><dt>Transcription</dt><dd>Runs on your machine</dd></div>
  <div class="fact"><dt>Latency</dt><dd>Warm mic, no record delay</dd></div>
  <div class="fact"><dt>Delivery</dt><dd>Pastes into any window</dd></div>
  <div class="fact"><dt>Platform</dt><dd>Windows 10 and 11, 64-bit</dd></div>
</dl>
`;

const flow = `
<style>
  ${fonts}
  :root { ${tokens} }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1600px; height: 300px; background: var(--bg); padding: 56px 64px;
    font-family: "Plus Jakarta Sans", sans-serif; color: var(--text);
    display: flex; align-items: stretch; gap: 0;
  }
  .step { flex: 1; padding: 0 36px; position: relative; }
  .step + .step { border-left: 1px solid var(--border); }
  .n { font-family: "Plus Jakarta Sans", sans-serif; font-size: 16px; color: var(--accent); letter-spacing: 0.08em; }
  h3 { margin-top: 14px; font-family: "Urbanist", sans-serif; font-size: 34px; font-weight: 400; letter-spacing: -0.01em; }
  p { margin-top: 12px; font-size: 19px; line-height: 1.5; color: var(--text-secondary); }
</style>
<div class="step">
  <span class="n">01</span>
  <h3>Hold</h3>
  <p>A low-level hook sees the key go down in any application, so the shortcut works where a global accelerator cannot.</p>
</div>
<div class="step">
  <span class="n">02</span>
  <h3>Speak</h3>
  <p>A hidden window holds the microphone open all day. Recording starts on the same frame, and keeps the 250ms before you pressed.</p>
</div>
<div class="step">
  <span class="n">03</span>
  <h3>Release</h3>
  <p>The audio goes straight to a local model. Nothing is written to disk, and nothing leaves the machine.</p>
</div>
<div class="step">
  <span class="n">04</span>
  <h3>Paste</h3>
  <p>The overlay never takes focus, so the text lands in the window you were already working in.</p>
</div>
`;

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });

for (const [name, html, width, height] of [
  ["hero", hero, 1600, 520],
  ["flow", flow, 1600, 300]
]) {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  await page.evaluate(() => globalThis.document.fonts.ready);
  const buffer = await page.screenshot();
  await writeFile(join(outDir, `${name}.png`), buffer);
  console.log(`[art] docs/images/${name}.png`);
}

await browser.close();
