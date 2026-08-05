import { chromium } from "playwright";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const brandDir = join(root, "resources", "brand");
const rendererAssetsDir = join(root, "src", "renderer", "assets");
const rendererMainDir = join(root, "src", "renderer", "main");
const symbolSvg = join(brandDir, "struq-symbol.svg");
const appIconSvg = join(brandDir, "struq-app-icon.svg");

await mkdir(rendererAssetsDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const renderSvg = async (input, output, size) => {
  const svg = await readFile(input, "utf8");
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`
  );
  await page.screenshot({ path: output, omitBackground: true });
};

const symbolOutputs = [
  ["struq-symbol.png", 1024],
  ["mark-512.png", 512],
  ["mark-256.png", 256],
  ["mark-128.png", 128]
];

for (const [name, size] of symbolOutputs) {
  await renderSvg(symbolSvg, join(brandDir, name), size);
}

const appOutputs = [
  ["favicon-16.png", 16],
  ["favicon-32.png", 32],
  ["app-48.png", 48],
  ["app-64.png", 64],
  ["app-128.png", 128],
  ["apple-touch-icon.png", 180],
  ["pwa-192.png", 192],
  ["app-256.png", 256],
  ["pwa-512.png", 512]
];

for (const [name, size] of appOutputs) {
  await renderSvg(appIconSvg, join(brandDir, name), size);
}

await browser.close();

const icoInputs = [16, 32, 48, 64, 128, 256].map((size) => ({
  size,
  path: join(brandDir, size === 16 || size === 32 ? `favicon-${String(size)}.png` : `app-${String(size)}.png`)
}));
const icoPngs = await Promise.all(icoInputs.map(async ({ size, path }) => ({ size, data: await readFile(path) })));
const headerSize = 6 + icoPngs.length * 16;
const header = Buffer.alloc(headerSize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(icoPngs.length, 4);

let offset = headerSize;
icoPngs.forEach(({ size, data }, index) => {
  const entry = 6 + index * 16;
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(data.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += data.length;
});

await writeFile(join(brandDir, "struq-voice.ico"), Buffer.concat([header, ...icoPngs.map(({ data }) => data)]));
await writeFile(
  join(brandDir, "site.webmanifest"),
  `${JSON.stringify(
    {
      name: "Struq Voice",
      short_name: "Struq Voice",
      icons: [
        { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
        { src: "pwa-512.png", sizes: "512x512", type: "image/png" }
      ],
      theme_color: "#F6F4EB",
      background_color: "#F6F4EB",
      display: "standalone"
    },
    null,
    2
  )}\n`
);
await copyFile(symbolSvg, join(brandDir, "favicon.svg"));
await copyFile(join(brandDir, "struq-voice.ico"), join(brandDir, "favicon.ico"));
await copyFile(symbolSvg, join(rendererAssetsDir, "struq-symbol.svg"));
await copyFile(symbolSvg, join(rendererMainDir, "favicon.svg"));
await copyFile(join(brandDir, "pwa-512.png"), join(root, "resources", "icon.png"));
await copyFile(join(brandDir, "struq-voice.ico"), join(root, "resources", "icon.ico"));

console.log(`Generated ${String(symbolOutputs.length + appOutputs.length + 7)} brand assets.`);
