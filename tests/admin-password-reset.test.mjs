import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/lib/users.functions.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "reset-test-boundaries",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(@tanstack\/react-start|@\/integrations\/supabase\/(auth-middleware|client.server)|@\/lib\/(viewer-roles|password-policy))$/,
          },
          (a) => ({ path: a.path, namespace: "mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
          contents:
            a.path === "@tanstack/react-start"
              ? `export function createServerFn(){let schema; const c={middleware(){return c},inputValidator(s){schema=s;return c},handler(fn){return async a=>fn({...a,data:schema?schema.parse(a.data):a.data})}};return c}`
              : a.path.endsWith("auth-middleware")
                ? "export const requireSupabaseAuth={};"
                : a.path.endsWith("client.server")
                  ? "export const supabaseAdmin=new Proxy({}, {get:(_,p)=>globalThis.__resetAdmin[p]});"
                  : a.path.endsWith("viewer-roles")
                    ? "export const assignsAllColleges=()=>false, requiresCollegeAssignment=()=>false, requiresExactlyOneCollege=()=>false;"
                    : "export const requiresInitialPassword=()=>true;",
          loader: "js",
        }));
      },
    },
  ],
});
const { adminGeneratePasswordReset: reset } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);
const targetId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000001";
const input = {
  context: { userId: actorId },
  data: { user_id: targetId, email: "test@example.invalid" },
};

function setup(options = {}) {
  const updates = [],
    audits = [],
    links = [];
  let targetReads = 0;
  globalThis.__resetAdmin = {
    from(table) {
      if (table === "audit_logs")
        return {
          insert: async (value) => {
            audits.push(value);
            return { error: null };
          },
        };
      assert.equal(table, "user_roles");
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        maybeSingle: async () => ({
          data: options.denied ? null : { role: "super_admin" },
          error: null,
        }),
        then(resolve, reject) {
          return Promise.resolve({
            data: options.noRoles
              ? []
              : [{ role: options.adminTarget ? "super_admin" : "college_dean" }],
            error: options.rolesError ? { message: "injected" } : null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
    rpc: async () => ({
      data: !options.rateLimited,
      error: options.rateError ? { message: "injected" } : null,
    }),
    auth: {
      admin: {
        getUserById: async (id) => {
          assert.equal(id, targetId);
          targetReads++;
          return {
            data: {
              user: {
                id,
                email: "test@example.invalid",
                app_metadata: { provider: "email", custom: "keep" },
              },
            },
            error: options.accountError ? { message: "injected" } : null,
          };
        },
        updateUserById: async (id, value) => {
          assert.equal(id, targetId);
          updates.push(value);
          return { error: options.updateError ? { message: "injected" } : null };
        },
        generateLink: async (value) => {
          links.push(value);
          return {
            data: {
              properties: {
                action_link: options.noLink ? null : "https://example.invalid/recovery",
              },
            },
            error: null,
          };
        },
      },
    },
  };
  return { updates, audits, links, reads: () => targetReads };
}

test("temporary password is saved before being returned, with mandatory change and safe audit", async () => {
  const f = setup();
  const result = await reset(input);
  assert.match(result.temporary_password, /^[A-Za-z0-9_-]{24}$/);
  assert.equal(result.temporary_password, f.updates[0].password);
  assert.equal(result.email, input.data.email);
  assert.equal(result.action_link, null);
  assert.equal(f.updates[0].app_metadata.must_change_password, true);
  assert.equal(f.updates[0].app_metadata.custom, "keep");
  assert.ok(f.updates[0].app_metadata.password_reset_after > 0);
  assert.equal(f.audits[0].entity_id, targetId);
  assert.equal(f.audits[0].actor_id, actorId);
  assert.doesNotMatch(JSON.stringify(f.audits), new RegExp(result.temporary_password));
  assert.deepEqual(f.audits[0].details, {});
  assert.equal(f.links.length, 0);
  assert.notEqual((await reset(input)).temporary_password, result.temporary_password);
});

test("authorization and rate-limit failures deny reset before reading or writing the target", async () => {
  for (const options of [{ denied: true }, { rateLimited: true }, { rateError: true }]) {
    const f = setup(options);
    await assert.rejects(() => reset(input));
    assert.equal(f.reads(), 0);
    assert.equal(f.updates.length, 0);
    assert.equal(f.links.length, 0);
  }
});

test("mismatched identity, missing roles and failed account reads never mutate credentials", async () => {
  for (const options of [{ accountError: true }, { rolesError: true }, { noRoles: true }]) {
    const f = setup(options);
    await assert.rejects(() => reset(input));
    assert.equal(f.updates.length, 0);
  }
  const f = setup();
  await assert.rejects(
    () => reset({ ...input, data: { ...input.data, email: "other@example.invalid" } }),
    /مطابقة/,
  );
  assert.equal(f.updates.length, 0);
});

test("failed password update never returns a credential or records completion", async () => {
  const f = setup({ updateError: true });
  await assert.rejects(() => reset(input), /تعذر تعيين/);
  assert.equal(f.audits.length, 0);
});

test("super admins retain explicit recovery without a forced-change dead end", async () => {
  const f = setup({ adminTarget: true });
  const result = await reset(input);
  assert.equal(result.temporary_password, null);
  assert.equal(result.action_link, "https://example.invalid/recovery");
  assert.equal(f.updates.length, 0);
  assert.deepEqual(f.links, [{ type: "recovery", email: "test@example.invalid" }]);
  setup({ adminTarget: true, noLink: true });
  await assert.rejects(() => reset(input), /تعذر إنشاء/);
});
