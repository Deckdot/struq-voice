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

/**
 * Raw RGBA to 24-bit BMP. NSIS reads BMP only, and pulling in an image
 * library for two wizard bitmaps is not worth the dependency, so the pixels
 * come straight from a canvas in the browser that already rendered them.
 *
 * BMP rows are stored bottom-up and padded to a 4-byte boundary.
 */
const rgbaToBmp = (data, width, height) => {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelDataSize = rowSize * height;
  const fileHeaderSize = 14;
  const infoHeaderSize = 40;
  const buffer = Buffer.alloc(fileHeaderSize + infoHeaderSize + pixelDataSize);

  buffer.write("BM", 0);
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(fileHeaderSize + infoHeaderSize, 10);
  buffer.writeUInt32LE(infoHeaderSize, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelDataSize, 34);

  let offset = fileHeaderSize + infoHeaderSize;
  for (let y = height - 1; y >= 0; y--) {
    let rowOffset = offset;
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      // BGR order, and any transparency is composited onto the linen page
      // colour: BMP has no alpha channel here.
      const alpha = data[index + 3] / 255;
      const blend = (channel, over) => Math.round(channel * alpha + over * (1 - alpha));
      buffer.writeUInt8(blend(data[index + 2], 0xeb), rowOffset++);
      buffer.writeUInt8(blend(data[index + 1], 0xf4), rowOffset++);
      buffer.writeUInt8(blend(data[index], 0xf6), rowOffset++);
    }
    offset += rowSize;
  }
  return buffer;
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

/**
 * The NSIS wizard art. electron-builder looks for these by name in
 * buildResources (resources/), and falls back to its own blue graphic when
 * they are absent, which is what shipped before this existed.
 *
 * BMP, not PNG: NSIS only reads BMP for the sidebar and header bitmaps.
 * The sizes are fixed by NSIS itself, 164x314 for the welcome/finish sidebar
 * and 150x57 for the header strip on the interior pages.
 */
/**
 * Screenshot the page, then read the PNG back through the browser's own
 * decoder into a canvas. Chromium already ships a correct PNG decoder, so
 * this needs no image dependency and no hand-rolled inflate.
 */
const renderHtmlToBmp = async (html, output, width, height) => {
  await page.setViewportSize({ width, height });
  await page.setContent(html);
  const png = await page.screenshot({ type: "png" });

  // This callback is serialised and runs inside Chromium, where Image and
  // document exist. Node's lint config cannot see that, hence the override.
  /* eslint-disable no-undef */
  const pixels = await page.evaluate(
    async ({ base64, w, h }) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = `data:image/png;base64,${base64}`;
      });
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, w, h);
      return Array.from(context.getImageData(0, 0, w, h).data);
    },
    { base64: png.toString("base64"), w: width, h: height }
  );
  /* eslint-enable no-undef */

  await writeFile(output, rgbaToBmp(pixels, width, height));
};

const markSvg = await readFile(symbolSvg, "utf8");

const sidebarHtml = `<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden}
  body{
    background:#F6F4EB;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    font-family:"Segoe UI",system-ui,sans-serif;
  }
  .mark{width:104px;height:104px;display:block}
  .mark svg{display:block;width:100%;height:100%}
  .name{
    margin-top:20px;font-size:19px;letter-spacing:-.01em;color:#294638;font-weight:600;
  }
  .tag{
    margin-top:6px;font-size:11px;color:#6B7A70;text-align:center;line-height:1.5;
    padding:0 22px;
  }
  .rule{margin-top:18px;width:34px;height:2px;background:#A65332;border-radius:2px}
</style>
<div class="mark">${markSvg}</div>
<div class="name">Struq Voice</div>
<div class="rule"></div>
<div class="tag">Hold a key.<br/>Speak. Release.</div>`;

const headerHtml = `<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden}
  body{
    background:#F6F4EB;display:flex;align-items:center;gap:10px;padding-left:14px;
    font-family:"Segoe UI",system-ui,sans-serif;
  }
  .mark{width:30px;height:30px;flex:none}
  .mark svg{display:block;width:100%;height:100%}
  .name{font-size:13px;color:#294638;font-weight:600;letter-spacing:-.01em}
</style>
<div class="mark">${markSvg}</div>
<div class="name">Struq Voice</div>`;

await renderHtmlToBmp(sidebarHtml, join(root, "resources", "installerSidebar.bmp"), 164, 314);
await copyFile(
  join(root, "resources", "installerSidebar.bmp"),
  join(root, "resources", "uninstallerSidebar.bmp")
);
await renderHtmlToBmp(headerHtml, join(root, "resources", "installerHeader.bmp"), 150, 57);

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
