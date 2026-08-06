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
import "@fontsource/urbanist/400.css";
import "@fontsource/urbanist/500.css";
import "@fontsource/urbanist/600.css";
import "@fontsource/urbanist/700.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "../styles/main.css";
// After the theme: the transparent-body rules must win over theme.css giving
// body the opaque linen page colour.
import "./overlay.css";
import "../main/lib/icons";
import { applyInitialTheme } from "../main/lib/theme";
import { Overlay } from "./overlay";
import type { OverlayWindowApi } from "../../shared/api";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root element in overlay window");
}

applyInitialTheme((window.struqVoice as OverlayWindowApi).initialTheme);

createRoot(rootElement).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>
);
