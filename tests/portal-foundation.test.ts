import { describe, expect, it } from "vitest";
import {
  assertNoPortalRoleMigrationInSource,
  PORTAL_FOUNDATION_ROLES_TODAY,
  PORTAL_FUTURE_ROLES_NOT_IN_ENUM,
  PORTAL_PLANNED_PAGES,
} from "../src/lib/portal/foundation";

describe("portal foundation", () => {
  it("exposes only existing app roles today", () => {
    expect([...PORTAL_FOUNDATION_ROLES_TODAY]).toEqual([
      "super_admin",
      "college_admin",
      "read_only",
    ]);
  });

  it("documents future roles without claiming they exist", () => {
    expect([...PORTAL_FUTURE_ROLES_NOT_IN_ENUM]).toEqual(["student", "instructor"]);
  });

  it("lists planned read-only pages", () => {
    expect(PORTAL_PLANNED_PAGES.length).toBeGreaterThanOrEqual(5);
    expect(PORTAL_PLANNED_PAGES.every((p) => p.path.startsWith("/portal/"))).toBe(true);
  });

  it("rejects student/instructor ADD VALUE migrations", () => {
    expect(assertNoPortalRoleMigrationInSource("")).toBe(true);
    expect(
      assertNoPortalRoleMigrationInSource("ALTER TYPE public.app_role ADD VALUE 'instructor';"),
    ).toBe(false);
  });
});
