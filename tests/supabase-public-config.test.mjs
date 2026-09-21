import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const client = readFileSync("src/integrations/supabase/client.ts", "utf8");
const serverClient = readFileSync("src/integrations/supabase/client.server.ts", "utf8");

test("browser client has a public runtime fallback without a service-role secret", () => {
  assert.match(client, /const PUBLIC_SUPABASE_URL = "https:\/\/[a-z0-9]+\.supabase\.co"/);
  assert.match(client, /const PUBLIC_SUPABASE_PUBLISHABLE_KEY =/);
  assert.match(client, /VITE_SUPABASE_URL[\s\S]*PUBLIC_SUPABASE_URL/);
  assert.match(
    client,
    /VITE_SUPABASE_PUBLISHABLE_KEY[\s\S]*PUBLIC_SUPABASE_PUBLISHABLE_KEY/,
  );
  assert.doesNotMatch(client, /service_role/);
  assert.doesNotMatch(client, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("service-role configuration stays server-only and fail-closed", () => {
  assert.match(serverClient, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serverClient, /throw new Error\(message\)/);
});
