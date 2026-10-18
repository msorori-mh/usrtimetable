// Browser + SSR Supabase client (publishable key, protected by RLS).
// Server secrets (service-role key) must never be referenced here — see client.server.ts.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const SUPABASE_CONFIG_ERROR_MESSAGE =
  "إعداد Supabase غير مكتمل: يلزم ضبط VITE_SUPABASE_URL وVITE_SUPABASE_PUBLISHABLE_KEY عند البناء " +
  "(أو SUPABASE_URL وSUPABASE_PUBLISHABLE_KEY على الخادم). " +
  "Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY at build time " +
  "(or SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the server).";

type PublicEnv = Record<string, string | undefined>;

function serverEnv(): PublicEnv {
  // `process` does not exist in the browser bundle; on the Worker it is provided by nodejs_compat.
  return typeof process !== "undefined" && process.env ? process.env : {};
}

/**
 * Resolve the public Supabase endpoint. Build-time VITE_* values win; the server falls back to
 * its runtime environment. There is intentionally NO hard-coded project fallback: a missing
 * configuration must fail loudly instead of silently talking to another project.
 */
export function resolveSupabasePublicConfig(
  buildEnv: PublicEnv = import.meta.env as unknown as PublicEnv,
  runtimeEnv: PublicEnv = serverEnv(),
): { url: string; publishableKey: string } {
  const url = (buildEnv.VITE_SUPABASE_URL || runtimeEnv.SUPABASE_URL || "").trim();
  const publishableKey = (
    buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
    runtimeEnv.SUPABASE_PUBLISHABLE_KEY ||
    ""
  ).trim();
  if (!url || !publishableKey) {
    const missing = [
      ...(!url ? ["VITE_SUPABASE_URL/SUPABASE_URL"] : []),
      ...(!publishableKey ? ["VITE_SUPABASE_PUBLISHABLE_KEY/SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    throw new Error(`${SUPABASE_CONFIG_ERROR_MESSAGE} [missing: ${missing.join(", ")}]`);
  }
  return { url, publishableKey };
}

function createSupabaseClient() {
  const { url, publishableKey } = resolveSupabasePublicConfig();
  return createClient<Database>(url, publishableKey, {
    auth: {
      // No custom storage: supabase-js uses window.localStorage in the browser (when
      // available) and an in-memory store during SSR.
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
// The client is created lazily on first use, so a configuration error surfaces there.
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
