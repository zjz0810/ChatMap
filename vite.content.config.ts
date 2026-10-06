import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, "src/content/index.ts"),
      output: {
        format: "iife",
        entryFileNames: "content/index.js",
        inlineDynamicImports: true,
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  }
});
