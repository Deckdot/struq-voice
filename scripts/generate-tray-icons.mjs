/**
 * Generates the tray icons: resources/tray/{idle,recording,transcribing}.png
 * plus @2x variants. Pure Node (zlib + a hand-rolled PNG encoder), so there
 * are no image dependencies. Colours are converted from the same oklch source
 * values as theme.css; shapes are drawn at 4x and supersampled down.
 *
 * Run: node scripts/generate-tray-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "resources", "tray");

// oklch source values, matching theme.css.
const oklchToRgb = (L, C, H) => {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b_ = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const gamma = (v) => {
    const clamped = Math.min(1, Math.max(0, v));
    return clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  };
  return [gamma(r), gamma(g), gamma(b_)];
};

// state-idle: muted forest. state-listening: the terracotta accent.
// state-transcribing: deep forest (accent-alt).
const IDLE = oklchToRgb(0.52, 0.018, 150);
const RECORDING = oklchToRgb(0.535, 0.12, 45);
const TRANSCRIBING = oklchToRgb(0.27, 0.03, 152);
// A light rim so shapes stay visible on a dark taskbar.
const RIM = oklchToRgb(0.985, 0.008, 95);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

const crc32 = (buffer) => {
  let crc = -1;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
};

const chunk = (type, data) => {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
};

const encodePng = (width, height, rgba) => {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
};

/**
 * Draw a shape into an RGBA canvas at supersample scale.
 * Shapes: "ring" (idle), "disc" (recording), "bars" (transcribing).
 */
const drawShape = (canvas, size, ss, shape, color, rimColor) => {
  const put = (x, y, r, g, b, a) => {
    // Composite with alpha over the current pixel.
    const i = (y * size * ss + x) * 4;
    const dstA = canvas[i + 3] / 255;
    const srcA = a;
    const outA = srcA + dstA * (1 - srcA);
    if (outA === 0) return;
    canvas[i] = Math.round((r * 255 * srcA + canvas[i] * dstA * (1 - srcA)) / outA);
    canvas[i + 1] = Math.round((g * 255 * srcA + canvas[i + 1] * dstA * (1 - srcA)) / outA);
    canvas[i + 2] = Math.round((b * 255 * srcA + canvas[i + 2] * dstA * (1 - srcA)) / outA);
    canvas[i + 3] = Math.round(outA * 255);
  };

  const disc = (cx, cy, radius, rgb) => {
    const r2 = radius * radius;
    for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
      for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
        const d = (x - cx) ** 2 + (y - cy) ** 2;
        if (d <= r2) {
          const alpha = Math.min(1, r2 - d + 0.5);
          put(x, y, rgb[0], rgb[1], rgb[2], alpha);
        }
      }
    }
  };

  const center = (size * ss) / 2;

  if (shape === "ring") {
    const outer = size * ss * 0.32;
    const inner = outer * 0.55;
    for (let y = 0; y < size * ss; y++) {
      for (let x = 0; x < size * ss; x++) {
        const d = Math.sqrt((x - center) ** 2 + (y - center) ** 2);
        if (d <= outer && d >= inner) {
          const edge = Math.min(d - inner, outer - d);
          put(x, y, color[0], color[1], color[2], Math.min(1, edge + 0.5));
        }
      }
    }
  } else if (shape === "disc") {
    disc(center, center, size * ss * 0.34, color);
    // A hairline rim so the disc reads on dark taskbars.
    disc(center, center, size * ss * 0.40, rimColor);
    disc(center, center, size * ss * 0.34, color);
  } else if (shape === "bars") {
    const barWidth = size * ss * 0.14;
    const heights = [0.55, 0.9, 0.65, 0.9, 0.55];
    const gap = (size * ss * 0.9) / heights.length;
    heights.forEach((h, i) => {
      const x0 = center - (gap * (heights.length - 1)) / 2 + i * gap;
      const y0 = center - (h * size * ss) / 2;
      const y1 = center + (h * size * ss) / 2;
      for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
        for (let x = Math.floor(x0); x <= Math.ceil(x0 + barWidth); x++) {
          const edge = Math.min(y - y0 + 0.5, y1 - y + 0.5, x - x0 + 0.5, x0 + barWidth - x + 0.5);
          put(x, y, color[0], color[1], color[2], Math.min(1, Math.max(0, edge)));
        }
      }
    });
  }
};

const downsample = (canvas, size, ss) => {
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * size * ss + x * ss + sx) * 4;
          const alpha = canvas[i + 3] / 255;
          r += canvas[i] * alpha;
          g += canvas[i + 1] * alpha;
          b += canvas[i + 2] * alpha;
          a += alpha;
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      out[o] = a === 0 ? 0 : Math.round(r / a);
      out[o + 1] = a === 0 ? 0 : Math.round(g / a);
      out[o + 2] = a === 0 ? 0 : Math.round(b / a);
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
};

const render = (size, shape, color, rimColor) => {
  const ss = 4;
  const canvas = Buffer.alloc(size * ss * size * ss * 4);
  drawShape(canvas, size, ss, shape, color, rimColor);
  return encodePng(size, size, downsample(canvas, size, ss));
};

const byRgb = (rgb) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(",")})`;

console.log(`Generating tray icons into ${OUT_DIR}`);
console.log(`  idle:        ${byRgb(IDLE)}`);
console.log(`  recording:   ${byRgb(RECORDING)}`);
console.log(`  transcribing:${byRgb(TRANSCRIBING)}`);

mkdirSync(OUT_DIR, { recursive: true });

for (const [name, shape, color] of [
  ["idle", "ring", IDLE],
  ["recording", "disc", RECORDING],
  ["transcribing", "bars", TRANSCRIBING]
]) {
  writeFileSync(join(OUT_DIR, `${name}.png`), render(16, shape, color, RIM));
  writeFileSync(join(OUT_DIR, `${name}@2x.png`), render(32, shape, color, RIM));
  console.log(`  wrote ${name}.png and ${name}@2x.png`);
}

console.log("Done.");
