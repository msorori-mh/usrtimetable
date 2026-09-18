import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const here = fileURLToPath(new URL("./", import.meta.url));
export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  publicDir: root + "public",
  resolve: {
    alias: [
      {
        find: /^@\/lib\/reports\/verification-api$/,
        replacement: here + "verification-api-mock.ts",
      },
      { find: /^@\/hooks\/reports\/useWeeklyGridWindow$/, replacement: here + "window.ts" },
      {
        find: /^@\/hooks\/use-colleges$/,
        replacement: root + "scripts/print-proof/mocks/use-colleges.ts",
      },
      {
        find: /^@tanstack\/react-router$/,
        replacement: root + "scripts/print-proof/mocks/react-router.tsx",
      },
      { find: /^@\//, replacement: root + "src/" },
    ],
  },
  server: { host: "127.0.0.1", port: 4173 },
  build: { outDir: root + "dist-reports-proof", emptyOutDir: true },
});
