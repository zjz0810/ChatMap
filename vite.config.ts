import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidePanel: resolve(__dirname, "src/side-panel/index.html"),
        fullPage: resolve(__dirname, "src/full-page/index.html"),
        settingsPage: resolve(__dirname, "src/settings-page/index.html"),
        background: resolve(__dirname, "src/background/service-worker.ts")
      },
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === "background") return "background/service-worker.js";
          return "assets/[name]-[hash].js";
        },
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
