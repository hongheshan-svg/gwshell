import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    // GWShell is a local Tauri desktop app; xterm/WebGL are split out below, and
    // the remaining app shell is still modest once gzipped.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("@xterm/xterm")) return "xterm-core";
          if (id.includes("@xterm/addon-canvas")) return "xterm-canvas";
          if (id.includes("@xterm/addon-webgl")) return "xterm-webgl";
          if (id.includes("@xterm/addon-fit") || id.includes("@xterm/addon-web-links")) {
            return "xterm-addons";
          }
          if (id.includes("@tauri-apps/")) return "tauri-api";
        },
      },
    },
  },
  resolve: {
    alias: {
      // @xterm/addon-canvas beta (0.8.0-beta.48) ships the ESM build as
      // lib/xterm-addon-canvas.mjs but package.json points module to the
      // non-existent lib/addon-canvas.mjs. Fix the entry until the package
      // is corrected upstream.
      "@xterm/addon-canvas": "@xterm/addon-canvas/lib/xterm-addon-canvas.mjs",
    },
  },
}));
