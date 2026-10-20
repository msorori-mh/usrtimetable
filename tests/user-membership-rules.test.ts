import { describe, expect, test } from "bun:test";
import {
  MEMBERSHIP_ERROR_AR,
  planCollegeChange,
  roleRemovalNeedsConfirmation,
  validateRoleChange,
} from "../src/lib/user-membership-rules";

const base = {
  actorId: "actor",
  targetId: "target",
  currentRoles: ["super_admin"],
  currentCollegeIds: [] as string[],
  superAdminCount: 3,
};

describe("L-3 validateRoleChange", () => {
  test("an admin cannot remove their own super_admin role", () => {
    expect(
      validateRoleChange({ ...base, targetId: "actor", role: "super_admin", enabled: false }),
    ).toBe(MEMBERSHIP_ERROR_AR.selfSuperAdmin);
  });

  test("the last super_admin can never be removed", () => {
    expect(
      validateRoleChange({ ...base, superAdminCount: 1, role: "super_admin", enabled: false }),
    ).toBe(MEMBERSHIP_ERROR_AR.lastSuperAdmin);
    expect(validateRoleChange({ ...base, role: "super_admin", enabled: false })).toBeNull();
  });

  test("a college dean must have exactly one college before the role is granted", () => {
    for (const colleges of [[], ["c1", "c2"]])
      expect(
        validateRoleChange({
          ...base,
          currentRoles: ["read_only"],
          currentCollegeIds: colleges,
          role: "college_dean",
          enabled: true,
        }),
      ).toBe(MEMBERSHIP_ERROR_AR.deanNeedsOneCollege);
    expect(
      validateRoleChange({
        ...base,
        currentRoles: ["read_only"],
        currentCollegeIds: ["c1"],
        role: "college_dean",
        enabled: true,
      }),
    ).toBeNull();
  });

  test("ordinary grants and removals are allowed", () => {
    expect(
      validateRoleChange({ ...base, currentRoles: [], role: "college_admin", enabled: true }),
    ).toBeNull();
    expect(
      validateRoleChange({
        ...base,
        currentRoles: ["read_only"],
        role: "read_only",
        enabled: false,
      }),
    ).toBeNull();
  });
});

describe("L-3 planCollegeChange", () => {
  test("adding a college to a dean replaces the previous one (final state = 1)", () => {
    expect(
      planCollegeChange({
        collegeId: "c2",
        enabled: true,
        currentRoles: ["college_dean"],
        currentCollegeIds: ["c1"],
      }),
    ).toEqual({ ok: true, add: ["c2"], remove: ["c1"], final: ["c2"] });
  });

  test("a dean cannot lose their only college", () => {
    expect(
      planCollegeChange({
        collegeId: "c1",
        enabled: false,
        currentRoles: ["college_dean"],
        currentCollegeIds: ["c1"],
      }),
    ).toEqual({ ok: false, error: MEMBERSHIP_ERROR_AR.deanCannotLoseCollege });
  });

  test("a dean with an invalid legacy state is repaired toward exactly one", () => {
    expect(
      planCollegeChange({
        collegeId: "c2",
        enabled: false,
        currentRoles: ["college_dean"],
        currentCollegeIds: ["c1", "c2"],
      }),
    ).toEqual({ ok: true, add: [], remove: ["c2"], final: ["c1"] });
  });

  test("non-dean accounts add and remove freely; no-ops are detected", () => {
    expect(
      planCollegeChange({
        collegeId: "c2",
        enabled: true,
        currentRoles: ["college_admin"],
        currentCollegeIds: ["c1"],
      }),
    ).toEqual({ ok: true, add: ["c2"], remove: [], final: ["c1", "c2"] });
    expect(
      planCollegeChange({
        collegeId: "c1",
        enabled: true,
        currentRoles: ["college_admin"],
        currentCollegeIds: ["c1"],
      }),
    ).toEqual({ ok: true, add: [], remove: [], final: ["c1"] });
    expect(
      planCollegeChange({
        collegeId: "c1",
        enabled: false,
        currentRoles: ["college_admin"],
        currentCollegeIds: ["c1"],
      }),
    ).toEqual({ ok: true, add: [], remove: ["c1"], final: [] });
  });

  test("removing admin roles requires a confirmation", () => {
    expect(roleRemovalNeedsConfirmation("super_admin")).toBe(true);
    expect(roleRemovalNeedsConfirmation("college_admin")).toBe(true);
    expect(roleRemovalNeedsConfirmation("read_only")).toBe(false);
  });
});
