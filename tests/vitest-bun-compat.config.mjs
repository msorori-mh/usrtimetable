import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const testRoot = fileURLToPath(new URL("./", import.meta.url));

// Local acceptance fallback for environments where the Bun binary is unavailable.
// Production CI continues to execute these files with `bun test`.
export default defineConfig({
  resolve: {
    alias: {
      "bun:test": `${testRoot}vitest-bun-test-compat.ts`,
      "@": fileURLToPath(new URL("../src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
  },
});
