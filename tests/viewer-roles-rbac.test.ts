/** RBAC contract for read_only and academic affairs (institutional_viewer). */
import { describe, expect, it } from "vitest";
import { ADMIN_PAGES, ALL, CORE_PATH, OPERATIONAL, canAccess } from "@/lib/admin-nav";
import {
  INSTITUTIONAL_VIEWER_ROLE_LABEL_AR,
  READ_ONLY_ROLE_LABEL_AR,
  REPORTS_ONLY_HOME,
  LEADERSHIP_HOME,
  assignsAllColleges,
  isAcademicAffairsRole,
  isFullPlatformViewerRole,
  isReportsOnlyRole,
  isViewerOnlyRole,
  requiresCollegeAssignment,
  resolveReportsOnlyRedirect,
  resolveViewerScopeRedirect,
  scopeCollegesForRole,
} from "@/lib/viewer-roles";

const visiblePaths = (role: "read_only" | "institutional_viewer") =>
  [...ADMIN_PAGES.filter((p) => canAccess(p, [role])).map((p) => p.to)].concat(
    CORE_PATH.filter((s) => canAccess(s, [role])).map((s) => s.to),
  );

const READ_ONLY = { isReadOnly: true } as const;
const VIEWER = { isInstitutionalViewer: true } as const;
const BOTH = { isReadOnly: true, isInstitutionalViewer: true } as const;
const SUPER = { isSuperAdmin: true, isReadOnly: true } as const;
const COLLEGE_ADMIN = { isCollegeAdmin: true, isReadOnly: true } as const;

describe("labels", () => {
  it("keeps the generic viewer and academic affairs distinct", () => {
    expect(READ_ONLY_ROLE_LABEL_AR).toBe("مشاهد");
    expect(INSTITUTIONAL_VIEWER_ROLE_LABEL_AR).toBe("إدارة الشؤون الأكاديمية");
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
    const paths = visiblePaths("read_only");
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((p) => p === "/reports" || p.startsWith("/reports/"))).toBe(true);
  });
});

describe("institutional_viewer is the academic-affairs role", () => {
  it("allows reports + instructors and blocks operational pages", () => {
    expect(isReportsOnlyRole(VIEWER)).toBe(false);
    expect(isAcademicAffairsRole(VIEWER)).toBe(true);
    expect(isFullPlatformViewerRole(VIEWER)).toBe(false);
    expect(resolveViewerScopeRedirect(VIEWER, "/reports")).toBeNull();
    expect(resolveViewerScopeRedirect(VIEWER, "/instructors")).toBeNull();
    expect(resolveViewerScopeRedirect(VIEWER, "/dashboard")).toBe(LEADERSHIP_HOME);
  });

  it("sees only instructors and reports in navigation", () => {
    const paths = visiblePaths("institutional_viewer");
    expect(paths).toContain("/instructors");
    expect(paths).toContain("/reports");
    expect(paths).not.toContain("/schedule-builder");
    expect(OPERATIONAL).not.toContain("institutional_viewer");
    expect(OPERATIONAL).not.toContain("read_only");
    expect(ALL).toContain("read_only");
    expect(ALL).toContain("institutional_viewer");
  });
});

describe("multi-role safety", () => {
  it("read_only + institutional_viewer follows academic-affairs scope", () => {
    expect(isReportsOnlyRole(BOTH)).toBe(false);
    expect(isAcademicAffairsRole(BOTH)).toBe(true);
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
  it("auto-assigns all colleges to academic affairs only", () => {
    expect(assignsAllColleges("read_only")).toBe(false);
    expect(assignsAllColleges("institutional_viewer")).toBe(true);
    expect(assignsAllColleges("college_admin")).toBe(false);
    expect(assignsAllColleges("super_admin")).toBe(false);
  });

  it("requires a manual picker for college admins and report viewers", () => {
    expect(requiresCollegeAssignment("college_admin")).toBe(true);
    expect(requiresCollegeAssignment("read_only")).toBe(true);
    expect(requiresCollegeAssignment("institutional_viewer")).toBe(false);
  });
});
