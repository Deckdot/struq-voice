import React, { useEffect } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../styles/main.css";
import { App } from "./App";
import { useMainStore } from "./store/use-main-store";
import type { CaptureState } from "../../shared/capture";
import type { MainWindowApi } from "../../shared/api";

function Bootstrap(): JSX.Element {
  useEffect(() => {
    const api = window.struqVoice as MainWindowApi;
    return api.onCaptureStateChanged((state: CaptureState) => {
      useMainStore.getState().setCapture(state);
    });
  }, []);
  return <App />;
}

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing #root element in main window");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <Bootstrap />
  </React.StrictMode>,
);
