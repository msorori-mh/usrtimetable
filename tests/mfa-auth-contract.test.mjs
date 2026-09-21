import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const auth = readFileSync("src/routes/auth.tsx", "utf8");
const accountSecurity = readFileSync(
  "src/routes/_authenticated/account-security.tsx",
  "utf8",
);
const adminNav = readFileSync("src/lib/admin-nav.ts", "utf8");

test("public authentication exposes sign-in only and gates verified TOTP at aal2", () => {
  assert.match(auth, /signInWithPassword/);
  assert.doesNotMatch(auth, /signUp\s*\(/);
  assert.match(auth, /getAuthenticatorAssuranceLevel/);
  assert.match(auth, /nextLevel\s*!==\s*"aal2"/);
  assert.match(auth, /currentLevel\s*===\s*"aal2"/);
  assert.match(auth, /listFactors/);
  assert.match(auth, /status\s*===\s*"verified"/);
  assert.match(auth, /mfa\.challenge/);
  assert.match(auth, /mfa\.verify/);
  assert.match(auth, /data-testid="auth-mfa-step"/);
});

test("account security requires an explicit owner action and a valid TOTP challenge", () => {
  assert.match(accountSecurity, /factorType:\s*"totp"/);
  assert.match(accountSecurity, /data-testid="account-security-enroll"/);
  assert.match(accountSecurity, /onClick=\{\(\) => void startEnroll\(\)\}/);
  assert.match(accountSecurity, /mfa\.challenge/);
  assert.match(accountSecurity, /mfa\.verify/);
  assert.match(accountSecurity, /code:\s*code\.trim\(\)/);
  assert.match(accountSecurity, /status\s*===\s*"verified"/);
  assert.match(accountSecurity, /mfa\.unenroll/);
});

test("account security remains reachable from the authenticated admin navigation", () => {
  assert.match(adminNav, /\/account-security/);
});
