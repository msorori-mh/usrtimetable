/**
 * Isolated build for the print/export proof fixtures.
 *
 * Deliberately minimal and separate from the app's vite.config.ts: it builds static
 * pages that import the REAL components, the REAL print stylesheet and the REAL export
 * helpers. No server, no database, no auth.
 *
 * Two entries:
 *  - index.html  — PrintSheet standalone (LAUNCH-CLOSURE-03)
 *  - shell.html  — the REAL AppLayout shell wrapping PrintSheet (LAUNCH-CLOSURE-04),
 *                  with only auth / data / navigation aliased to inert fixtures.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const here = fileURLToPath(new URL("./", import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  publicDir: projectRoot + "public",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^@\/integrations\/supabase\/client$/,
        replacement: here + "mocks/supabase-client.ts",
      },
      { find: /^@\/hooks\/use-current-user$/, replacement: here + "mocks/use-current-user.ts" },
      { find: /^@\/hooks\/use-colleges$/, replacement: here + "mocks/use-colleges.ts" },
      { find: /^@tanstack\/react-router$/, replacement: here + "mocks/react-router.tsx" },
      { find: /^@\//, replacement: projectRoot + "src/" },
    ],
  },
  build: {
    outDir: projectRoot + "dist-print-proof",
    emptyOutDir: true,
    rollupOptions: {
      input: { index: here + "index.html", shell: here + "shell.html" },
    },
  },
});
