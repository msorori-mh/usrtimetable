/**
 * Isolated build for the LAUNCH-CLOSURE-03 print/export proof fixture.
 *
 * Deliberately minimal and separate from the app's vite.config.ts: it builds a static
 * page that imports the REAL components, the REAL print stylesheet and the REAL export
 * helpers. No server, no database, no auth, no router.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./", import.meta.url)),
  base: "./",
  publicDir: projectRoot + "public",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": projectRoot + "src" },
  },
  build: {
    outDir: projectRoot + "dist-print-proof",
    emptyOutDir: true,
  },
});
