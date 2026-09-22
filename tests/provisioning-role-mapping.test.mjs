import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const fns = readFileSync("src/lib/users.functions.ts", "utf8");
const usersPage = readFileSync("src/routes/_authenticated/users.tsx", "utf8");

const ALLOWED_DB_ROLES = [
  "super_admin",
  "college_admin",
  "read_only",
  "institutional_viewer",
  "university_leadership",
];

test("the users page offers the college dean option as college_dean", () => {
  assert.match(usersPage, /college_dean/);
});

test("college_dean is provisioned as college_admin at the trusted boundary", () => {
  assert.match(fns, /PROVISIONING_ROLE_BY_ROLE[\s\S]*college_dean:\s*"college_admin"/);
});

test("the grant is issued with the mapped provisioning role, never the raw UI role", () => {
  assert.match(
    fns,
    /issue_account_provisioning_grant"[\s\S]{0,160}p_role:\s*provisioningRole/,
  );
  assert.doesNotMatch(
    fns,
    /issue_account_provisioning_grant"[\s\S]{0,160}p_role:\s*data\.role/,
  );
});

test("auth metadata carries the mapped provisioning role only", () => {
  assert.doesNotMatch(fns, /provisioning_role:\s*data\.role/);
  assert.match(fns, /provisioning_role:\s*provisioningRole/);
});

test("every mapped provisioning role is inside the unchanged database allow-list", () => {
  const block = fns.match(/PROVISIONING_ROLE_BY_ROLE[^{]*\{([\s\S]*?)\};/)[1];
  const mapped = [...block.matchAll(/:\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(mapped.length === 6);
  for (const role of mapped) assert.ok(ALLOWED_DB_ROLES.includes(role), role);
  assert.ok(!mapped.includes("college_dean"));
});

test("unmapped / illegal roles are rejected fail-closed before any account is created", () => {
  assert.match(fns, /if \(!provisioningRole\) \{[\s\S]{0,140}throw new Error\(/);
  const guardIndex = fns.indexOf("if (!provisioningRole)");
  assert.ok(guardIndex > 0 && guardIndex < fns.indexOf("auth.admin.createUser"));
});

test("the single-college rule for the dean is untouched", () => {
  assert.match(
    fns,
    /requiresExactlyOneCollege\(data\.role\) && collegeIds\.length !== 1/,
  );
  assert.match(fns, /user_roles"\)\s*\n?\s*\.insert\(\{ user_id: newId, role: data\.role/);
});
