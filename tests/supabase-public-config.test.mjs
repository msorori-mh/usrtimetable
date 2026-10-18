import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const client = readFileSync("src/integrations/supabase/client.ts", "utf8");
const serverClient = readFileSync("src/integrations/supabase/client.server.ts", "utf8");

test("browser client reads deployment configuration only (no hard-coded project fallback)", () => {
  assert.match(client, /VITE_SUPABASE_URL\s*\|\|\s*runtimeEnv\.SUPABASE_URL/);
  assert.match(client, /VITE_SUPABASE_PUBLISHABLE_KEY\s*\|\|\s*runtimeEnv\.SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(client, /PUBLIC_SUPABASE_URL|PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(client, /https:\/\/[a-z0-9]{20}\.supabase\.co/);
  assert.doesNotMatch(client, /eyJ[A-Za-z0-9_-]{10,}\./, "no embedded JWT/publishable key");
  assert.doesNotMatch(client, /service_role/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("missing configuration fails loudly with an Arabic + English message", () => {
  assert.match(client, /throw new Error\(`\$\{SUPABASE_CONFIG_ERROR_MESSAGE\}/);
  assert.match(client, /إعداد Supabase غير مكتمل/);
  assert.match(client, /Supabase is not configured/);
});

test("session storage is the supabase-js default (no editor session broker)", () => {
  assert.doesNotMatch(client, /brokeredPreviewStorage|previewAuthStorage|postMessage/);
  assert.equal(existsSync("src/integrations/supabase/previewAuthStorage.ts"), false);
  assert.doesNotMatch(client, /automatically generated/i);
});

test("service-role configuration stays server-only and fail-closed", () => {
  assert.match(serverClient, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serverClient, /throw new Error\(message\)/);
  assert.doesNotMatch(serverClient, /Lovable/i);
});
