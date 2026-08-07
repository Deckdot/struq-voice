import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const rendererRoot = resolve(__dirname, "src/renderer");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/main/index.ts"),
        // Force CJS. The main process uses `__dirname` for preload and
        // renderer paths, which does not exist in ESM. Pinning CJS keeps
        // the output format deterministic.
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "[name].cjs",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // One preload per window type. All are sandboxed and use the same
        // contextBridge pattern; each window loads its own file.
        input: {
          main: resolve(__dirname, "src/preload/main.ts"),
          overlay: resolve(__dirname, "src/preload/overlay.ts"),
          recorder: resolve(__dirname, "src/preload/recorder.ts"),
          meeting: resolve(__dirname, "src/preload/meeting.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
          chunkFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    root: rendererRoot,
    resolve: {
      alias: {
        "@": rendererRoot,
      },
    },
    build: {
      // The pcm-collector worklet is loaded via audioWorklet.addModule, which
      // cannot load data: URLs. Force every asset to a real file.
      assetsInlineLimit: 0,
      rollupOptions: {
        // Multi-page Vite build. Four windows, four entries. Output lands
        // at out/renderer/<name>/index.html and is loaded by each window.
        input: {
          main: resolve(rendererRoot, "main/index.html"),
          overlay: resolve(rendererRoot, "overlay/index.html"),
          recorder: resolve(rendererRoot, "recorder/index.html"),
          meeting: resolve(rendererRoot, "meeting/index.html"),
        },
      },
    },
  },
});
