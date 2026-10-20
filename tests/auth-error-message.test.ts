import { expect, test } from "bun:test";
import { AUTH_GENERIC_ERROR_AR, translateAuthError } from "../src/lib/auth-error-message";
import {
  knownBackendMessage,
  serverFailure,
  isMissingFunctionError,
} from "../src/lib/server-errors";

test("L-5 /auth maps known Supabase messages and never shows raw backend text", () => {
  expect(translateAuthError("Invalid login credentials")).toBe(
    "بيانات الدخول غير صحيحة أو الحساب غير مخوّل",
  );
  expect(translateAuthError("Password should be at least 12 characters")).toMatch(/كلمة المرور/);
  expect(
    translateAuthError("For security purposes, you can only request this after 42 seconds"),
  ).toMatch(/محاولات كثيرة/);
  for (const raw of [
    'duplicate key value violates unique constraint "x"',
    "Database error querying schema",
    "AuthApiError: unexpected_failure at https://abcd.supabase.co",
  ])
    expect(translateAuthError(raw)).toBe(AUTH_GENERIC_ERROR_AR);
  // Our own fixed Arabic messages (session checks) are kept.
  expect(translateAuthError("تعذّر التحقق من الهوية. (HTTP 503)")).toBe(
    "تعذّر التحقق من الهوية. (HTTP 503)",
  );
});

test("L-5 server failures log details and return a fixed Arabic message with a reference", () => {
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    const err = serverFailure("تعذّر إنشاء الحساب.", {
      message: 'insert or update on table "user_roles" violates foreign key constraint',
      code: "XX000",
    });
    expect(err.message).toMatch(/^تعذّر إنشاء الحساب\. \(المرجع: [0-9a-f]{8}\)$/);
    expect(err.message).not.toMatch(/user_roles|constraint/);
    const ref = err.message.match(/([0-9a-f]{8})/)![1];
    expect(String(logged[0][0])).toContain(ref);
    expect(logged[0][1]).toMatchObject({ code: "XX000" });
  } finally {
    console.error = original;
  }
});

test("L-3/L-5 known backend codes map to Arabic (LAST_SUPER_ADMIN, duplicates)", () => {
  expect(knownBackendMessage({ message: "LAST_SUPER_ADMIN", code: "P0001" })).toMatch(
    /آخر مدير نظام/,
  );
  expect(
    knownBackendMessage({ message: "A user with this email address has already been registered" }),
  ).toMatch(/يوجد حساب/);
  expect(knownBackendMessage({ message: "whatever", code: "XX000" })).toBeNull();
  expect(isMissingFunctionError({ code: "PGRST202", message: "Could not find the function" })).toBe(
    true,
  );
  expect(isMissingFunctionError({ code: "42883", message: "function x does not exist" })).toBe(
    true,
  );
  expect(isMissingFunctionError({ code: "42501", message: "permission denied" })).toBe(false);
});
