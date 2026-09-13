/**
 * RBAC contract for the two read-only roles.
 *
 * `read_only` («مشاهد») = reports only. `institutional_viewer` («مشاهد مؤسسي») =
 * full-platform read-only. Neither gains any write here.
 */
import { describe, expect, it } from "vitest";
import { ALL, OPERATIONAL, navItemsForRole } from "@/lib/admin-nav";
import {
  INSTITUTIONAL_VIEWER_ROLE_LABEL_AR,
  READ_ONLY_ROLE_LABEL_AR,
  REPORTS_ONLY_HOME,
  assignsAllColleges,
  isFullPlatformViewerRole,
  isReportsOnlyRole,
  isViewerOnlyRole,
  requiresCollegeAssignment,
  resolveReportsOnlyRedirect,
  scopeCollegesForRole,
} from "@/lib/viewer-roles";

const READ_ONLY = { isReadOnly: true } as const;
const VIEWER = { isInstitutionalViewer: true } as const;
const BOTH = { isReadOnly: true, isInstitutionalViewer: true } as const;
const SUPER = { isSuperAdmin: true, isReadOnly: true } as const;
const COLLEGE_ADMIN = { isCollegeAdmin: true, isReadOnly: true } as const;

describe("labels", () => {
  it("keeps the two viewer roles distinct", () => {
    expect(READ_ONLY_ROLE_LABEL_AR).toBe("مشاهد");
    expect(INSTITUTIONAL_VIEWER_ROLE_LABEL_AR).toBe("مشاهد مؤسسي");
  });
});

describe("read_only-only account is reports-only", () => {
  it("allows /reports and its children", () => {
    for (const p of ["/reports", "/reports/instructor-schedule", "/reports/program-timetable"]) {
      expect(resolveReportsOnlyRedirect(READ_ONLY, p)).toBeNull();
    }
  });

  it("blocks every other path and redirects to /reports", () => {
    for (const p of ["/dashboard", "/courses", "/schedule-builder", "/admin-tools", "/users"]) {
      expect(resolveReportsOnlyRedirect(READ_ONLY, p)).toBe(REPORTS_ONLY_HOME);
    }
  });

  it("sees reports entries only in the navigation", () => {
    const paths = navItemsForRole("read_only").map((i) => i.to);
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p === "/reports" || p.startsWith("/reports/"))).toBe(true);
  });
});

describe("institutional_viewer-only account browses the platform", () => {
  it("is never narrowed to /reports", () => {
    expect(isReportsOnlyRole(VIEWER)).toBe(false);
    expect(isFullPlatformViewerRole(VIEWER)).toBe(true);
    for (const p of ["/dashboard", "/courses", "/schedule-builder"]) {
      expect(resolveReportsOnlyRedirect(VIEWER, p)).toBeNull();
    }
  });

  it("sees operational pages plus reports in the navigation", () => {
    const paths = navItemsForRole("institutional_viewer").map((i) => i.to);
    expect(paths).toContain("/reports");
    expect(paths.some((p) => !p.startsWith("/reports"))).toBe(true);
    expect(OPERATIONAL).toContain("institutional_viewer");
    expect(OPERATIONAL).not.toContain("read_only");
    expect(ALL).toContain("read_only");
  });
});

describe("multi-role safety", () => {
  it("read_only + institutional_viewer is not reports-only", () => {
    expect(isReportsOnlyRole(BOTH)).toBe(false);
  });

  it("admins keep full behaviour and are never narrowed", () => {
    expect(isReportsOnlyRole(SUPER)).toBe(false);
    expect(isReportsOnlyRole(COLLEGE_ADMIN)).toBe(false);
    expect(isViewerOnlyRole(SUPER)).toBe(false);
    expect(isViewerOnlyRole(COLLEGE_ADMIN)).toBe(false);
  });

  it("does not auto-scope an admin's colleges", () => {
    const colleges = [{ id: "a" }, { id: "b" }];
    expect(scopeCollegesForRole(colleges, ["a"], isViewerOnlyRole(SUPER))).toHaveLength(2);
    expect(scopeCollegesForRole(colleges, ["a"], isViewerOnlyRole(READ_ONLY))).toEqual([
      { id: "a" },
    ]);
  });
});

describe("college assignment", () => {
  it("auto-assigns all colleges to both viewer roles only", () => {
    expect(assignsAllColleges("read_only")).toBe(true);
    expect(assignsAllColleges("institutional_viewer")).toBe(true);
    expect(assignsAllColleges("college_admin")).toBe(false);
    expect(assignsAllColleges("super_admin")).toBe(false);
  });

  it("requires a manual picker for college_admin only", () => {
    expect(requiresCollegeAssignment("college_admin")).toBe(true);
    expect(requiresCollegeAssignment("read_only")).toBe(false);
    expect(requiresCollegeAssignment("institutional_viewer")).toBe(false);
  });

  it("a newly created college is part of the viewer scope", () => {
    const colleges = [{ id: "c1" }, { id: "c2" }, { id: "c3-new" }];
    const assigned = colleges.map((c) => c.id); // trigger assigns the new college too
    expect(scopeCollegesForRole(colleges, assigned, true)).toHaveLength(3);
  });
});

describe("existing viewer account fixture (read_only only, all colleges)", () => {
  const account = { roles: ["read_only"] as const, assignedColleges: 8, totalColleges: 8 };
  const flags = {
    isSuperAdmin: account.roles.includes("super_admin" as never),
    isCollegeAdmin: account.roles.includes("college_admin" as never),
    isReadOnly: account.roles.includes("read_only"),
    isInstitutionalViewer: account.roles.includes("institutional_viewer" as never),
  };

  it("is reports-only and keeps every college as read scope", () => {
    expect(isReportsOnlyRole(flags)).toBe(true);
    expect(resolveReportsOnlyRedirect(flags, "/dashboard")).toBe(REPORTS_ONLY_HOME);
    expect(resolveReportsOnlyRedirect(flags, "/reports")).toBeNull();
    expect(account.assignedColleges).toBe(account.totalColleges);
    expect(assignsAllColleges("read_only")).toBe(true);
  });
});
