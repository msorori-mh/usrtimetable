import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const users = readFileSync("src/lib/users.functions.ts", "utf8");
const rollback = readFileSync("supabase/rollbacks/20260922_account_provisioning_grant.sql", "utf8");

test("super-admin proof and rate limit precede grant issuance and user creation", () => {
  const adminCheck = users.indexOf("await assertInstitutionAdmin(context.userId)");
  const limit = users.indexOf('assertRateLimit(context.userId, "user_create")');
  const issue = users.indexOf('"issue_account_provisioning_grant"');
  const create = users.indexOf("supabaseAdmin.auth.admin.createUser");
  assert.ok(adminCheck >= 0 && adminCheck < limit);
  assert.ok(limit < issue, "grant must be issued after the rate limit");
  assert.ok(issue < create, "grant must exist before the auth insert");
});

test("grant is bound to normalized email, role and creator", () => {
  assert.match(users, /const normalizedEmail = data\.email\.trim\(\)\.toLowerCase\(\)/);
  assert.match(
    users,
    /p_email: normalizedEmail, p_role: provisioningRole, p_created_by: context\.userId/,
  );
  assert.match(users, /email: normalizedEmail,/);
});

test("nonce and role reach the guard through both metadata channels", () => {
  assert.match(users, /provisioning_role: provisioningRole,\s*provisioning_nonce: grant\.nonce,/);
  assert.match(users, /must_change_password: requiresInitialPassword\(data\.role\)/);
});

test("issuance failure fails closed and createUser failure revokes the grant", () => {
  assert.match(users, /if \(grantErr \|\| !grant\) \{\s*throw new Error/);
  const failure = users.slice(
    users.indexOf("if (createErr || !created.user) {"),
    users.indexOf("const newId = created.user.id"),
  );
  assert.match(failure, /revoke_account_provisioning_grant/);
  assert.match(failure, /action: "user_create_failed"/);
  assert.doesNotMatch(failure, /password/);
});

test("consumed grants are cleaned up after success", () => {
  const after = users.slice(users.indexOf("const newId = created.user.id"));
  assert.match(after, /revoke_account_provisioning_grant/);
});

test("rollback restores the previous guard and drops the grant mechanism", () => {
  assert.match(rollback, /CREATE OR REPLACE FUNCTION public\.enforce_admin_account_creation/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.issue_account_provisioning_grant/);
  assert.match(rollback, /DROP TABLE IF EXISTS provisioning_private\.account_provisioning_grants/);
  assert.doesNotMatch(rollback, /college_dean/);
});

test("the allowed role list is unchanged and college_dean is not introduced", () => {
  assert.match(users, /const ROLE = z\.enum\(\[/);
  assert.match(
    rollback,
    /'super_admin','college_admin','read_only','institutional_viewer','university_leadership'/,
  );
});
