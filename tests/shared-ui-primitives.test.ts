import { test, expect } from "bun:test";
import { formatDate, formatNumber, formatDateTime } from "../src/lib/format";
import { isAdmin, isSuperAdmin, ROLES } from "../src/lib/roles";
import { userErrorMessage } from "../src/lib/user-error";

test("format uses Latin digits and never shifts calendar dates", () => {
  expect(formatNumber(1234.5)).toMatch(/^[0-9.,٬٫\s]+$/);
  expect(formatNumber(1234)).not.toMatch(/[٠-٩]/);
  expect(formatDate("2026-10-15")).toContain("15");
  expect(formatDate("2026-10-15")).not.toMatch(/[٠-٩]/);
  expect(formatDateTime("2026-10-15T21:30:00Z")).toContain("16"); // 00:30 next day in Aden (UTC+3)
  expect(formatDate(null)).toBe("—");
});

test("role predicates", () => {
  expect(isSuperAdmin([ROLES.superAdmin])).toBe(true);
  expect(isAdmin(["college_admin"])).toBe(true);
  expect(isAdmin(["read_only"])).toBe(false);
  expect(isAdmin(null)).toBe(false);
});

test("user errors: Arabic passes through, raw errors are mapped", () => {
  expect(userErrorMessage(new Error("لا يمكن حذف القاعة"))).toBe("لا يمكن حذف القاعة");
  expect(
    userErrorMessage({
      code: "23505",
      message: 'duplicate key value violates unique constraint "rooms_code_key"',
    }),
  ).not.toContain("rooms_code_key");
  expect(userErrorMessage(new TypeError("Failed to fetch"))).toContain("الاتصال");
  const generic = userErrorMessage(new Error('relation "secret_table" does not exist'));
  expect(generic).not.toContain("secret_table");
});
