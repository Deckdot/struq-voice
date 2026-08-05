# Struq Voice logo pack

The master mark is `struq-symbol.svg`. It is transparent and should be used
for interfaces, websites, documents, and other brand surfaces.

The app tile is `struq-app-icon.svg`. Its linen field keeps the mark legible
against both light and dark Windows surfaces.

Run `pnpm brand:generate` after changing either master SVG. The generator
creates the PNG sizes, favicon files, Windows ICO, renderer assets, and the
root application icons used by electron-builder.

## Files

- `struq-symbol.svg`: transparent vector master
- `struq-symbol.png`: transparent 1024px master PNG
- `mark-512.png`: transparent web mark
- `mark-256.png`: transparent web mark
- `mark-128.png`: transparent web mark
- `favicon.svg`: scalable browser favicon
- `favicon.ico`: multi-size legacy browser favicon
- `favicon-16.png`: 16px browser favicon
- `favicon-32.png`: 32px browser favicon
- `apple-touch-icon.png`: 180px Apple touch icon
- `pwa-192.png`: 192px web app icon
- `pwa-512.png`: 512px web app icon
- `site.webmanifest`: web app metadata and icon references
- `struq-app-icon.svg`: linen-backed app icon master
- `struq-voice.ico`: multi-size Windows application icon
