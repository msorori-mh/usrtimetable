import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { withSecurityHeaders } from "../src/lib/security-headers.ts";

const bundle = await build({
  entryPoints: ["src/lib/security-guard.server.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "service-boundary",
      setup(b) {
        b.onResolve({ filter: /client\.server$/ }, (a) => ({ path: a.path, namespace: "mock" }));
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: "export const supabaseAdmin={rpc:(...a)=>globalThis.__securityRpc(...a)}",
          loader: "js",
        }));
      },
    },
  ],
});
const { assertLiveSecuritySession, enforceSecurityLimit } = await import(
  "data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].text).toString("base64")
);

test("privileged operations reject revoked identity, invalid session, MFA and password bypass", async () => {
  let user = { id: "a" },
    error = null;
  let state = { session_valid: true, mfa_required: false, password_required: false };
  const client = {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    rpc: async () => ({ data: state, error }),
  };
  await assertLiveSecuritySession(client, "a");
  user = { id: "different" };
  await assert.rejects(() => assertLiveSecuritySession(client, "a"));
  user = { id: "a" };
  state.session_valid = false;
  await assert.rejects(() => assertLiveSecuritySession(client, "a", true));
  state.session_valid = true;
  state.mfa_required = true;
  await assert.rejects(() => assertLiveSecuritySession(client, "a"));
  state.password_required = true;
  await assertLiveSecuritySession(client, "a", true);
  state.mfa_required = false;
  await assert.rejects(() => assertLiveSecuritySession(client, "a"));
  error = { message: "offline" };
  await assert.rejects(() => assertLiveSecuritySession(client, "a", true));
});

test("sensitive operations fail closed on rate limiter outage or exhaustion", async () => {
  globalThis.__securityRpc = async (name, args) => {
    assert.equal(name, "consume_security_limit");
    assert.equal(args.p_actor, "a");
    return { data: true, error: null };
  };
  await enforceSecurityLimit("a", "user_admin");
  globalThis.__securityRpc = async () => ({ data: false, error: null });
  await assert.rejects(() => enforceSecurityLimit("a", "password_change"));
  globalThis.__securityRpc = async () => ({ data: true, error: { message: "offline" } });
  await assert.rejects(() => enforceSecurityLimit("a", "user_admin"));
  delete globalThis.__securityRpc;
});

test("security headers preserve content and errors, block production embedding and sensitive caching", async () => {
  const result = withSecurityHeaders(
    new Response("private", { status: 500, headers: { "content-type": "text/html" } }),
    new Request("https://gomufadhala.com/dashboard"),
  );
  assert.equal(result.status, 500);
  assert.equal(await result.text(), "private");
  assert.equal(result.headers.get("x-frame-options"), "DENY");
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.equal(result.headers.get("x-content-type-options"), "nosniff");
  assert.match(result.headers.get("strict-transport-security"), /31536000/);
  const preview = withSecurityHeaders(
    new Response("preview"),
    new Request("https://example.lovable.app/"),
  );
  assert.equal(preview.headers.get("x-frame-options"), null);
  const post = withSecurityHeaders(
    new Response("{}"),
    new Request("https://gomufadhala.com/_serverFn/test", { method: "POST" }),
  );
  assert.equal(post.headers.get("cache-control"), "no-store");
});
