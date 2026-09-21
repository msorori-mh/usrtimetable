import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import { validPersonalPassword, requiresInitialPassword } from "../src/lib/password-policy.ts";

test("password policy requires eight characters, letters and numbers or symbols", () => {
  for (const value of [
    "abc123!",
    "abcdefgh",
    "12345678",
    "!!!!!!!!",
    "abcd    ",
    "A".repeat(72) + "1",
  ])
    assert.equal(validPersonalPassword(value), false, value);
  for (const value of ["abcdefg1", "abcdefg!", "كلمةمرور8", "Strong pass!"])
    assert.equal(validPersonalPassword(value), true, value);
  assert.equal(requiresInitialPassword("super_admin"), false);
  for (const role of [
    "college_admin",
    "read_only",
    "institutional_viewer",
    "university_leadership",
  ])
    assert.equal(requiresInitialPassword(role), true);
});

const bundled = await build({
  entryPoints: ["src/lib/password-change.functions.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "auth-test-boundaries",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^(@tanstack\/react-start|@supabase\/supabase-js|@\/integrations\/supabase\/(auth-middleware|client.server))$/,
          },
          (a) => ({ path: a.path, namespace: "mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({
          contents:
            a.path === "@tanstack/react-start"
              ? `export function createServerFn(){ let schema; const c={middleware(){return c},inputValidator(s){schema=s;return c},handler(fn){return async a=>fn({...a,data:schema.parse(a.data)})}};return c}`
              : a.path === "@supabase/supabase-js"
                ? "export const createClient=()=>globalThis.__pwVerifier;"
                : a.path.endsWith("auth-middleware")
                  ? "export const requireSupabaseAuth={};"
                  : "export const supabaseAdmin=new Proxy({}, {get:(_,p)=>globalThis.__pwAdmin[p]});",
          loader: "js",
        }));
      },
    },
  ],
});
const { completeInitialPasswordChange: change } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

test("server rejects admin, weak/reused passwords and wrong temporary credential; clears flag only after success", async () => {
  let role = "read_only",
    verified = true,
    fail = false,
    updated = 0,
    signedOut = 0;
  let user = {
    id: "user-1",
    email: "test-only@example.invalid",
    app_metadata: { must_change_password: true, provider: "email" },
  };
  globalThis.__pwAdmin = {
    rpc: async () => ({ data: true, error: null }),
    from(table) {
      if (table === "user_roles")
        return { select: () => ({ eq: async () => ({ data: [{ role }], error: null }) }) };
      return { insert: async () => ({ error: null }) };
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user }, error: null }),
        updateUserById: async (id, input) => {
          assert.equal(id, "user-1");
          if (fail) return { error: { message: "injected" } };
          updated++;
          user = { ...user, app_metadata: input.app_metadata };
          return { error: null };
        },
      },
    },
  };
  globalThis.__pwVerifier = {
    auth: {
      signInWithPassword: async () => ({
        data: { user: verified ? { id: "user-1" } : null },
        error: verified ? null : { message: "invalid" },
      }),
      signOut: async () => {
        signedOut++;
      },
    },
  };
  const input = {
    context: {
      userId: "user-1",
      supabase: {
        auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
        rpc: async () => ({
          data: { session_valid: true, password_required: true, mfa_required: false },
          error: null,
        }),
      },
    },
    data: { currentPassword: "Temporary123!", newPassword: "Personal123!" },
  };
  role = "super_admin";
  await assert.rejects(() => change(input), /الأدمن/);
  assert.equal(updated, 0);
  role = "read_only";
  await assert.rejects(() =>
    change({ ...input, data: { ...input.data, newPassword: "abcdefgh" } }),
  );
  await assert.rejects(
    () => change({ ...input, data: { ...input.data, newPassword: input.data.currentPassword } }),
    /مختلفة/,
  );
  verified = false;
  await assert.rejects(() => change(input), /غير صحيحة/);
  assert.equal(updated, 0);
  verified = true;
  fail = true;
  await assert.rejects(() => change(input), /تعذر حفظ/);
  assert.equal(user.app_metadata.must_change_password, true);
  fail = false;
  assert.deepEqual(await change(input), { ok: true });
  assert.equal(updated, 1);
  assert.equal(user.app_metadata.must_change_password, false);
  assert.equal(user.app_metadata.provider, "email");
  assert.equal(signedOut, 2);
  await assert.rejects(() => change(input), /لا يوجد/);
  delete globalThis.__pwAdmin;
  delete globalThis.__pwVerifier;
});

test("database blocks direct reads and RPC paths until password change, while admins stay exempt", async () => {
  const { PGlite } = await import(
    resolve(
      process.env.PASSWORD_QA_MODULES ?? "../tooling/node_modules",
      "@electric-sql/pglite/dist/index.js",
    )
  );
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key,raw_app_meta_data jsonb);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
      CREATE TABLE public.user_roles(user_id uuid,role text);
      CREATE FUNCTION public.is_super_admin(id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=id AND role='super_admin') $$;
      CREATE TABLE public.test_timetable(id int); INSERT INTO public.test_timetable VALUES(1);
      ALTER TABLE public.test_timetable ENABLE ROW LEVEL SECURITY;
      CREATE POLICY existing_access ON public.test_timetable TO authenticated USING(true) WITH CHECK(true);
      GRANT SELECT,INSERT ON public.test_timetable TO authenticated;
      INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000001','{}'),('00000000-0000-0000-0000-000000000002','{}');
      INSERT INTO public.user_roles VALUES('00000000-0000-0000-0000-000000000002','super_admin');`);
    await db.exec(
      readFileSync("supabase/migrations/20260920030000_initial_password_change.sql", "utf8"),
    );
    assert.equal(
      (
        await db.query(
          `SELECT raw_app_meta_data FROM auth.users WHERE id='00000000-0000-0000-0000-000000000002'`,
        )
      ).rows[0].raw_app_meta_data.must_change_password,
      undefined,
    );
    await db.exec(`UPDATE auth.users SET raw_app_meta_data='{"must_change_password":true}';
      SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`);
    assert.equal(
      (await db.query("select public.password_change_required() as required")).rows[0].required,
      true,
    );
    assert.equal((await db.query("select * from public.test_timetable")).rows.length, 0);
    await assert.rejects(
      () => db.exec("insert into public.test_timetable values(2)"),
      /row-level security/,
    );
    await db.exec(`SELECT set_config('request.path','/rpc/arbitrary_application_function',false);`);
    await assert.rejects(
      () => db.query("select public.enforce_initial_password_change()"),
      /PASSWORD_CHANGE_REQUIRED/,
    );
    await db.exec(
      `SELECT set_config('request.path','/rpc/password_change_required',false); select public.enforce_initial_password_change();`,
    );
    await db.exec(
      `SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);`,
    );
    assert.equal(
      (await db.query("select public.password_change_required() as required")).rows[0].required,
      false,
    );
    assert.equal((await db.query("select * from public.test_timetable")).rows.length, 1);
    await db.exec(`RESET ROLE; UPDATE auth.users SET raw_app_meta_data='{"must_change_password":false}' WHERE id='00000000-0000-0000-0000-000000000001';
      INSERT INTO auth.users VALUES('00000000-0000-0000-0000-000000000003','{}'),('00000000-0000-0000-0000-000000000004','{"provisioning_role":"super_admin"}');`);
    const newUsers = (await db.query(`SELECT id,raw_app_meta_data FROM auth.users ORDER BY id`))
      .rows;
    assert.equal(newUsers[2].raw_app_meta_data.must_change_password, true);
    assert.equal(newUsers[3].raw_app_meta_data.must_change_password, false);
    await db.exec(
      `SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);`,
    );
    assert.equal((await db.query("select * from public.test_timetable")).rows.length, 1);
    await db.exec(
      `RESET ROLE; UPDATE auth.users SET raw_app_meta_data='{"must_change_password":false,"password_reset_after":100}' WHERE id='00000000-0000-0000-0000-000000000001'; SET ROLE authenticated; SELECT set_config('request.jwt.claims','{"iat":99}',false);`,
    );
    assert.equal((await db.query("select * from public.test_timetable")).rows.length, 0);
    await db.exec(`SELECT set_config('request.jwt.claims','{"iat":101}',false);`);
    assert.equal((await db.query("select * from public.test_timetable")).rows.length, 1);
  } finally {
    await db.close();
  }
});
