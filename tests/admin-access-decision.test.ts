import { describe, expect, test } from "bun:test";
import {
  ADMIN_ACCESS_DENIAL_AR,
  INITIAL_PASSWORD_CHANGE_POLICY,
  SUPER_ADMIN_POLICY,
  evaluateAdminAccess,
  parseAccessStatus,
} from "../src/lib/admin-access";

const ready = { session_valid: true, password_required: false, mfa_required: false };
const aal2 = { sub: "u1", aal: "aal2" };
const aal1 = { sub: "u1", aal: "aal1" };

describe("H-11 evaluateAdminAccess (super-admin actions)", () => {
  test("a stolen password (aal1 session) cannot run a super-admin action", () => {
    expect(evaluateAdminAccess(ready, aal1, ["super_admin"])).toEqual({
      ok: false,
      reason: "aal2_required",
    });
    expect(evaluateAdminAccess(ready, { sub: "u1" }, ["super_admin"]).ok).toBe(false);
    expect(evaluateAdminAccess(ready, null, ["super_admin"]).ok).toBe(false);
  });

  test("allows a ready aal2 super-admin session", () => {
    expect(evaluateAdminAccess(ready, aal2, ["college_admin", "super_admin"])).toEqual({
      ok: true,
    });
  });

  test("revoked sessions, pending MFA and pending password change are rejected", () => {
    expect(evaluateAdminAccess({ ...ready, session_valid: false }, aal2, ["super_admin"])).toEqual({
      ok: false,
      reason: "session_invalid",
    });
    expect(evaluateAdminAccess({ ...ready, mfa_required: true }, aal2, ["super_admin"])).toEqual({
      ok: false,
      reason: "mfa_required",
    });
    expect(
      evaluateAdminAccess({ ...ready, password_required: true }, aal2, ["super_admin"]),
    ).toEqual({ ok: false, reason: "password_change_required" });
  });

  test("the role must come from the caller's own roles", () => {
    expect(evaluateAdminAccess(ready, aal2, ["college_admin"])).toEqual({
      ok: false,
      reason: "forbidden",
    });
    expect(evaluateAdminAccess(ready, aal2, [])).toEqual({ ok: false, reason: "forbidden" });
    expect(evaluateAdminAccess(ready, aal2, null)).toEqual({
      ok: false,
      reason: "roles_unavailable",
    });
  });

  test("malformed or missing status fails closed", () => {
    for (const status of [
      null,
      undefined,
      "ok",
      [],
      {},
      { session_valid: "true", password_required: false, mfa_required: false },
      { session_valid: true, password_required: false },
    ])
      expect(evaluateAdminAccess(status, aal2, ["super_admin"])).toEqual({
        ok: false,
        reason: "status_unavailable",
      });
    expect(parseAccessStatus({ ...ready, extra: 1 })).toEqual(ready);
  });

  test("order: session state is evaluated before roles (no role probe on a dead session)", () => {
    expect(evaluateAdminAccess({ ...ready, session_valid: false }, aal1, null).ok).toBe(false);
    expect(
      (evaluateAdminAccess({ ...ready, session_valid: false }, aal1, null) as { reason: string })
        .reason,
    ).toBe("session_invalid");
  });
});

describe("H-11 initial password change policy", () => {
  test("works while the password change is pending and without aal2", () => {
    expect(
      evaluateAdminAccess(
        { ...ready, password_required: true },
        aal1,
        null,
        INITIAL_PASSWORD_CHANGE_POLICY,
      ),
    ).toEqual({ ok: true });
  });

  test("still rejects revoked sessions and pending MFA", () => {
    expect(
      evaluateAdminAccess(
        { ...ready, session_valid: false },
        aal1,
        null,
        INITIAL_PASSWORD_CHANGE_POLICY,
      ).ok,
    ).toBe(false);
    expect(
      evaluateAdminAccess(
        { ...ready, mfa_required: true },
        aal1,
        null,
        INITIAL_PASSWORD_CHANGE_POLICY,
      ).ok,
    ).toBe(false);
  });

  test("super admin policy requires aal2 and the super_admin role", () => {
    expect(SUPER_ADMIN_POLICY).toEqual({
      role: "super_admin",
      requireAal2: true,
      allowPendingPasswordChange: false,
    });
  });

  test("every denial has a fixed Arabic message", () => {
    for (const message of Object.values(ADMIN_ACCESS_DENIAL_AR)) {
      expect(message).toMatch(/[؀-ۿ]/);
      expect(message).not.toMatch(/Unauthorized|Forbidden|SUPABASE/);
    }
  });
});
