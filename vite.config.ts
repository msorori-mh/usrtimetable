// Explicit build configuration (no hosting-platform wrapper package).
//
// Plugin order follows the TanStack Start hosting guide: tanstackStart() → nitro() → react().
// vite-tsconfig-paths provides the "@/…" alias from tsconfig.json → compilerOptions.paths.
//
// Output: `vite build` emits a Cloudflare Workers bundle in .output/ through the nitro
// `cloudflare_module` preset. nitro also writes .output/server/wrangler.json
// (main=index.mjs, no_bundle=true, assets.directory=../public), which
// scripts/staging/deploy-preflight.mjs validates and binds to the target Worker.
//
// Environment: Vite exposes VITE_* variables (from .env files or the process environment)
// to the client as import.meta.env.VITE_*. Server-only secrets are read at request time from
// process.env inside handlers (Cloudflare Worker secrets via nodejs_compat).
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig, type PluginOption } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ command }) => {
  const plugins: PluginOption[] = [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (SSR error wrapper +
      // security headers). nitro builds the Worker from this entry.
      server: { entry: "server" },
    }),
  ];

  // nitro is build-only, as before: `vite dev` uses TanStack Start's own dev server.
  if (command === "build") {
    plugins.push(
      nitro({
        preset: "cloudflare_module",
        // Pinned Workers compatibility date (reproducible deploys). Must stay >= 2025-04-01 so
        // nodejs_compat populates process.env from Worker secrets (checked by deploy-preflight).
        compatibilityDate: "2026-06-01",
        cloudflare: {
          // Native Node.js APIs on Workers: nitro adds the `nodejs_compat` compatibility flag
          // to the generated wrangler.json (verified by deploy-preflight in production mode).
          nodeCompat: true,
          // Emit the Wrangler deploy config consumed by the deploy workflows.
          deployConfig: true,
        },
      }),
    );
  }

  plugins.push(viteReact());

  return {
    plugins,
    resolve: {
      dedupe: [
        "react",
        "react-dom",
        "@tanstack/react-router",
        "@tanstack/react-start",
        "@tanstack/react-query",
      ],
    },
    server: {
      // Local dev URL used throughout the docs/QA notes: http://localhost:8080
      port: 8080,
    },
  };
});
