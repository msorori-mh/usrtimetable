import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const bundled = await build({
  entryPoints: ["src/hooks/use-current-user.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [
    {
      name: "identity-read-boundary",
      setup(builder) {
        builder.onResolve(
          { filter: /^(@tanstack\/react-query|@\/integrations\/supabase\/client)$/ },
          (arg) => ({ path: arg.path, namespace: "stub" }),
        );
        builder.onLoad({ filter: /.*/, namespace: "stub" }, (arg) => ({
          contents:
            arg.path === "@tanstack/react-query"
              ? "export const useQuery = options => options;"
              : "export const supabase = new Proxy({}, {get:(_,key)=>globalThis.__reportIdentityClient[key]});",
          loader: "js",
        }));
      },
    },
  ],
});
const { fetchCurrentUser } = await import(
  "data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
);

test("identity reads reject partial/failed permissions and recover with the original college scope", async () => {
  let failure = null;
  const expected = {
    profiles: { id: "test-user", full_name: "Test", email: null },
    user_roles: [{ role: "college_dean" }],
    user_colleges: [{ college_id: "college-a" }],
  };
  globalThis.__reportIdentityClient = {
    auth: {
      getUser: async () => ({ data: { user: { id: "test-user", email: null } }, error: null }),
    },
    from(table) {
      return {
        select() {
          return {
            eq() {
              const result = {
                data: failure === table ? null : expected[table],
                error: failure === table ? { code: "57014" } : null,
              };
              return { ...result, maybeSingle: async () => result };
            },
          };
        },
      };
    },
  };
  try {
    for (const table of Object.keys(expected)) {
      failure = table;
      await assert.rejects(fetchCurrentUser(), /صلاحيات الحساب/);
    }
    failure = null;
    const me = await fetchCurrentUser();
    assert.equal(me.isCollegeDean, true);
    assert.equal(me.isSuperAdmin, false);
    assert.deepEqual(me.collegeIds, ["college-a"]);
    assert.deepEqual(me.roles, ["college_dean"]);
  } finally {
    delete globalThis.__reportIdentityClient;
  }
});

test("request-guard execution is restored without changing its body, data access or MFA/session gates", async () => {
  const { PGlite } = await import(
    resolve(
      process.env.PASSWORD_QA_MODULES ?? "../tooling/node_modules",
      "@electric-sql/pglite/dist/index.js",
    )
  );
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE unrelated_role;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE FUNCTION public.security_session_valid() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.session_valid')::boolean $$;
      CREATE FUNCTION public.security_mfa_required() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.mfa_required')::boolean $$;
      CREATE FUNCTION public.password_change_required() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('test.password_required')::boolean $$;
      CREATE FUNCTION public.enforce_initial_password_change() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
      BEGIN
        IF auth.uid() IS NULL THEN RETURN; END IF;
        IF NOT public.security_session_valid() THEN RAISE SQLSTATE 'PT401' USING MESSAGE='SESSION_REVOKED'; END IF;
        IF trim(both '/' from coalesce(current_setting('request.path',true),'')) IN ('rpc/password_change_required','rpc/security_access_status') THEN RETURN; END IF;
        IF public.password_change_required() THEN RAISE SQLSTATE 'PT403' USING MESSAGE='PASSWORD_CHANGE_REQUIRED'; END IF;
        IF public.security_mfa_required() THEN RAISE SQLSTATE 'PT403' USING MESSAGE='MFA_REQUIRED'; END IF;
      END $$;
      REVOKE ALL ON FUNCTION public.enforce_initial_password_change() FROM PUBLIC,anon;
      GRANT EXECUTE ON FUNCTION public.enforce_initial_password_change() TO authenticated,service_role;
      CREATE TABLE public.test_report_data(college text); INSERT INTO public.test_report_data VALUES ('allowed'),('other');
      ALTER TABLE public.test_report_data ENABLE ROW LEVEL SECURITY;
      GRANT SELECT ON public.test_report_data TO authenticated;
      CREATE POLICY college_scope ON public.test_report_data TO authenticated USING(college=current_setting('test.college'));
      SELECT set_config('test.college','allowed',false),set_config('test.session_valid','true',false),set_config('test.password_required','false',false),set_config('test.mfa_required','false',false);`);
    const definition = async () =>
      (
        await db.query(
          "SELECT pg_get_functiondef('public.enforce_initial_password_change()'::regprocedure) AS body",
        )
      ).rows[0].body;
    const before = await definition();
    await db.exec("SET ROLE anon;");
    await assert.rejects(
      db.query("SELECT public.enforce_initial_password_change()"),
      /permission denied/,
    );
    await db.exec("RESET ROLE;");
    const migration = readFileSync(
      "supabase/migrations/20260923220000_restore_request_guard_execution.sql",
      "utf8",
    );
    await db.exec(migration);
    await db.exec(migration); // idempotent recovery
    assert.equal(await definition(), before);
    assert.equal(
      (
        await db.query(
          "SELECT has_function_privilege('unrelated_role','public.enforce_initial_password_change()','EXECUTE') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
    await db.exec("SET ROLE anon;");
    await db.query("SELECT public.enforce_initial_password_change()");
    await assert.rejects(db.query("SELECT * FROM public.test_report_data"), /permission denied/);
    await db.exec(
      "SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false); SELECT set_config('request.path','/test_report_data',false);",
    );
    for (const [setting, value, message] of [
      ["test.session_valid", "false", "SESSION_REVOKED"],
      ["test.password_required", "true", "PASSWORD_CHANGE_REQUIRED"],
      ["test.mfa_required", "true", "MFA_REQUIRED"],
    ]) {
      await db.query("SELECT set_config($1,$2,false)", [setting, value]);
      await assert.rejects(
        db.query("SELECT public.enforce_initial_password_change()"),
        new RegExp(message),
      );
      await db.query("SELECT set_config($1,$2,false)", [
        setting,
        setting === "test.session_valid" ? "true" : "false",
      ]);
    }
    await db.query("SELECT public.enforce_initial_password_change()");
    assert.deepEqual((await db.query("SELECT * FROM public.test_report_data")).rows, [
      { college: "allowed" },
    ]);
    await db.exec(
      "SELECT set_config('test.mfa_required','true',false),set_config('request.path','/rpc/security_access_status',false);",
    );
    await db.query("SELECT public.enforce_initial_password_change()");
  } finally {
    await db.close();
  }
});
