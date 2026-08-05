/**
 * The overlay window's entry point.
 *
 * The panel needs the same token layer as the main window: Tailwind for the
 * utility classes and theme.css for every --color-* the panel and the canvas
 * visualiser resolve at runtime. Without the stylesheet the panel renders
 * unstyled and the visualiser cannot resolve its bar colour.
 *
 * Fonts are imported here rather than inherited: this window loads its own
 * document, so nothing the main window imported is in scope.
 */

import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../styles/main.css";
// After the theme: the transparent-body rules must win over theme.css giving
// body the opaque linen page colour.
import "./overlay.css";
import { Overlay } from "./overlay";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root element in overlay window");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>
);
