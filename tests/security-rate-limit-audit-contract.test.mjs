import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const hardening = readFileSync(
  "supabase/migrations/20260921145225_c199c9a3-4edb-4cc9-b56c-aa2484537fee.sql",
  "utf8",
);
const membership = readFileSync(
  "supabase/migrations/20260921145509_df370d10-589d-40b9-9f24-c2f52a576ade.sql",
  "utf8",
);
const users = readFileSync("src/lib/users.functions.ts", "utf8");
const passwordChange = readFileSync("src/lib/password-change.functions.ts", "utf8");

test("audit writes are server-derived and direct authenticated mutation is closed", () => {
  assert.match(hardening, /v_actor uuid := auth\.uid\(\)/);
  assert.match(hardening, /AUDIT_REQUIRES_AUTH/);
  assert.match(hardening, /AUDIT_BLOCKED_SESSION_NOT_READY/);
  assert.match(hardening, /AUDIT_COLLEGE_NOT_PERMITTED/);
  assert.match(hardening, /DROP POLICY IF EXISTS al_insert ON public\.audit_logs/);
  assert.match(hardening, /REVOKE INSERT, UPDATE, DELETE ON public\.audit_logs FROM authenticated/);
  assert.match(
    hardening,
    /GRANT EXECUTE ON FUNCTION public\.record_audit_log\([\s\S]*?\) TO authenticated/,
  );
});

test("sensitive operations use finite fail-closed per-actor limits", () => {
  const expected = new Map([
    ["password_change", 5],
    ["user_admin", 20],
    ["user_create", 10],
    ["password_reset_admin", 10],
    ["role_change", 20],
    ["data_import", 30],
  ]);
  for (const [action, cap] of expected) {
    assert.match(
      hardening,
      new RegExp(`WHEN '${action}' THEN cap:=${cap}; duration:=interval '\\d+ (?:minute|minutes)'`),
      action,
    );
  }
  assert.match(hardening, /IF p_actor IS NULL THEN RETURN false/);
  assert.match(hardening, /ELSE RAISE EXCEPTION 'Unsupported security action'/);
  assert.match(hardening, /IF n=cap\+1 THEN[\s\S]*?'rate_limit_exceeded'/);
  assert.match(
    hardening,
    /REVOKE ALL ON FUNCTION public\.consume_security_limit\(uuid, text\) FROM PUBLIC/,
  );
  assert.match(
    hardening,
    /GRANT EXECUTE ON FUNCTION public\.consume_security_limit\(uuid, text\) TO service_role/,
  );
});

test("role and college membership mutation is throttled and trigger helpers are private", () => {
  for (const table of ["user_roles", "user_colleges"]) {
    assert.match(
      membership,
      new RegExp(
        `CREATE TRIGGER trg_${table}_rate_limit[\\s\\S]*?ON public\\.${table}[\\s\\S]*?EXECUTE FUNCTION public\\.enforce_membership_change_rate_limit`,
      ),
      table,
    );
  }
  assert.match(membership, /RATE_LIMITED_MEMBERSHIP_CHANGE/);
  for (const fn of [
    "enforce_initial_password_change",
    "enforce_admin_account_creation",
    "capture_security_audit",
    "capture_security_membership",
  ]) {
    assert.match(
      membership,
      new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(\\) FROM PUBLIC`),
      fn,
    );
  }
});

test("server handlers consume limits before privileged auth mutations", () => {
  const createLimit = users.indexOf('assertRateLimit(context.userId, "user_create")');
  const createUser = users.indexOf("supabaseAdmin.auth.admin.createUser");
  assert.ok(createLimit >= 0 && createLimit < createUser);

  const adminLimit = users.indexOf('assertRateLimit(context.userId, "user_admin")');
  const updateUser = users.indexOf("supabaseAdmin.auth.admin.updateUserById");
  assert.ok(adminLimit >= 0 && adminLimit < updateUser);

  const resetLimit = users.indexOf('assertRateLimit(context.userId, "password_reset_admin")');
  const resetLink = users.indexOf("supabaseAdmin.auth.admin.generateLink");
  assert.ok(resetLimit >= 0 && resetLimit < resetLink);
  const resetUpdate = users.indexOf("supabaseAdmin.auth.admin.updateUserById", resetLimit);
  assert.ok(resetUpdate > resetLimit);

  const passwordLimit = passwordChange.indexOf('p_action: "password_change"');
  const credentialCheck = passwordChange.indexOf("signInWithPassword");
  assert.ok(passwordLimit >= 0 && passwordLimit < credentialCheck);

  for (const source of [users, passwordChange]) {
    assert.match(source, /if \((?:error|limitError) \|\| (?:data|allowed) !== true\)/);
  }
});

test("super-admin security event visibility is read-only, bounded and fail-closed", () => {
  const route = readFileSync("src/routes/_authenticated/users.tsx", "utf8");
  assert.match(route, /const canViewSecurityEvents = me\?\.isSuperAdmin === true/);
  assert.match(route, /enabled: canViewSecurityEvents/);
  assert.match(route, /refetchInterval: 60_000/);
  assert.match(
    route,
    /\.from\("security_events"\)[\s\S]*?\.select\("id, actor_id, event, severity, details, target_id, created_at"\)[\s\S]*?\.limit\(50\)/,
  );
  const query = route.slice(
    route.indexOf('queryKey: ["security-events-recent"]'),
    route.indexOf("const securityEvents24h"),
  );
  assert.doesNotMatch(query, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.match(route, /token\|secret\|password\|api\[_-\]\?key\|jwt\|authorization\|cookie\/i/);
  assert.match(route, /SENSITIVE_DETAIL_KEY\.test\(key\) \? "•••"/);
  assert.match(route, /لم يتم افتراض أن الحالة آمنة/);
  assert.match(route, /data-testid="security-events-panel"/);
});
