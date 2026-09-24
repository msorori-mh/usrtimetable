import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/20260922090100_college_dean_leadership_scope.sql",
  "utf8",
);
const page = readFileSync("src/routes/_authenticated/reports.leadership.tsx", "utf8");
const users = readFileSync("src/routes/_authenticated/users.tsx", "utf8");
const server = readFileSync("src/lib/users.functions.ts", "utf8");

test("college dean RPC scope is derived from auth identity and fails closed", () => {
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /has_role\(v_actor, 'college_dean'/);
  assert.match(migration, /COLLEGE_DEAN_REQUIRES_EXACTLY_ONE_COLLEGE/);
  assert.match(migration, /COLLEGE_SCOPE_VIOLATION/);
  assert.match(migration, /p_college_id := v_scope_college/);
  assert.match(migration, /v_scope_college IS NULL OR cl\.id=v_scope_college/);
  assert.match(migration, /h\.home_college_id=v_scope_college/);
});

test("college dean cannot obtain operational write permissions", () => {
  assert.doesNotMatch(migration, /can_manage_college[\s\S]*college_dean/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*FOR (INSERT|UPDATE|DELETE)/);
  assert.doesNotMatch(page, /\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
});

test("admin creation requires one college and dashboard labels its restricted scope", () => {
  assert.match(server, /requiresExactlyOneCollege\(data\.role\)/);
  assert.match(server, /collegeIds\.length !== 1/);
  assert.match(users, /يجب إسناد كلية واحدة فقط لعميد الكلية/);
  assert.match(users, /f\.role === "college_dean"[\s\S]*\[c\.id\]/);
  assert.match(page, /title=\{executiveDashboardTitle\(me\)\}/);
  assert.match(page, /بيانات الكلية المُسندة فقط/);
});
