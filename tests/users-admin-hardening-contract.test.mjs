import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const fns = readFileSync("src/lib/users.functions.ts", "utf8");
const page = readFileSync("src/routes/_authenticated/users.tsx", "utf8");
const middleware = readFileSync("src/integrations/supabase/secure-admin-middleware.ts", "utf8");
const authMiddleware = readFileSync("src/integrations/supabase/auth-middleware.ts", "utf8");
const passwordChange = readFileSync("src/lib/password-change.functions.ts", "utf8");

test("H-11: every exported admin server function uses requireSecureAdmin", () => {
  const exported = [...fns.matchAll(/export const (\w+) = createServerFn\(/g)].map((m) => m[1]);
  assert.deepEqual(exported.sort(), [
    "adminCreateUser",
    "adminGeneratePasswordReset",
    "adminListUserMeta",
    "adminSetUserEnabled",
    "setUserCollege",
    "setUserRole",
  ]);
  const chains = fns.split(/export const \w+ = createServerFn\(/).slice(1);
  for (const chain of chains)
    assert.match(chain, /^\{ method: "POST" \}\)\s*\.middleware\(\[requireSecureAdmin\]\)/);
  assert.doesNotMatch(fns, /requireSupabaseAuth|assertInstitutionAdmin/);
});

test("H-11: the middleware verifies with the caller's client and the super-admin policy", () => {
  assert.match(middleware, /\.middleware\(\[requireSupabaseAuth\]\)/);
  assert.match(middleware, /verifyCallerAccess\(\s*context\.supabase/);
  assert.match(middleware, /SUPER_ADMIN_POLICY/);
  assert.doesNotMatch(middleware, /client\.server|supabaseAdmin/);
  assert.match(passwordChange, /verifyCallerAccess\([\s\S]*INITIAL_PASSWORD_CHANGE_POLICY/);
});

test("L-5: no raw backend message is rethrown and the middleware hides env names", () => {
  assert.doesNotMatch(fns, /throw new Error\(\w+(?:\?)?\.message/);
  assert.doesNotMatch(fns, /createErr\?\.message|grantErr\?\.message/);
  assert.doesNotMatch(authMiddleware, /throw new Error\(message\)|throw new Error\('Unauthorized/);
  assert.doesNotMatch(authMiddleware, /throw new Error\(`[^`]*SUPABASE/);
});

test("L-2: disabling an account revokes its sessions, tolerating an undeployed RPC", () => {
  const body = fns.slice(fns.indexOf("export const adminSetUserEnabled"));
  const ban = body.indexOf("ban_duration });");
  const revoke = body.indexOf('"admin_revoke_user_sessions"');
  assert.ok(ban > 0 && revoke > ban);
  assert.match(body, /p_user_id: data\.user_id/);
  assert.match(body, /isMissingFunctionError\(revokeErr\)[\s\S]{0,80}console\.warn/);
});

test("L-3: the page no longer writes user_roles / user_colleges directly", () => {
  assert.doesNotMatch(page, /from\("user_roles"\)\s*\.(insert|delete|upsert|update)/);
  assert.doesNotMatch(page, /from\("user_colleges"\)\s*\.(insert|delete|upsert|update)/);
  assert.match(page, /setRoleFn\(\{ data: \{ userId, role, enabled: on \} \}\)/);
  assert.match(page, /setCollegeFn\(\{ data: \{ userId, collegeId, enabled: on \} \}\)/);
  assert.match(page, /roleRemovalNeedsConfirmation\(role\)[\s\S]{0,80}confirmAction\(/);
  assert.match(fns, /validateRoleChange\(/);
  assert.match(fns, /planCollegeChange\(/);
});

test("L-8: institutional viewers load the name+role directory only", () => {
  const query = page.slice(page.indexOf('queryKey: ["all-users-admin"'), page.indexOf("const { data: colleges }"));
  const viewerBranch = query.slice(query.indexOf("if (viewOnly)"), query.indexOf("H-10"));
  assert.match(viewerBranch, /rpc\("list_user_directory"/);
  assert.doesNotMatch(viewerBranch, /from\("profiles"\)|listMeta\(/);
  assert.match(viewerBranch, /email: null/);
  assert.match(page, /\{!viewOnly && \(\s*<p className="text-xs text-muted-foreground" dir="ltr">\s*\{u\.email\}/);
  assert.match(page, /expanded && !viewOnly/);
});

test("H-10 (users page): the full lists are read page by page in a deterministic order", () => {
  assert.equal((page.match(/readAllRows</g) ?? []).length, 3);
  for (const table of ["profiles", "user_roles", "user_colleges"])
    assert.match(
      page,
      new RegExp(`from\\("${table}"\\)[\\s\\S]{0,120}\\.order\\([\\s\\S]{0,80}\\.range\\(from, to\\)`),
      table,
    );
});

test("L-6: the AI suggestions feature is gone", () => {
  assert.equal(existsSync("src/lib/unresolved-row-suggestions.functions.ts"), false);
  assert.equal(existsSync("src/routes/_authenticated/unresolved-suggestions.tsx"), false);
  assert.doesNotMatch(readFileSync("src/routeTree.gen.ts", "utf8"), /unresolved-suggestions|UnresolvedSuggestions/);
});
