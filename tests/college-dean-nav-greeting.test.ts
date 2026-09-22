/**
 * Regression: college dean navigation entry + greeting line.
 * Server-side scope stays with leadership_overview / leadership_metric_details.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ADMIN_PAGES,
  CORE_PATH,
  COLLEGE_DEAN_LEADERSHIP_LABEL_AR,
  canAccess,
  coreStepLabel,
  type Role,
} from "@/lib/admin-nav";
import { buildAccountGreeting } from "@/lib/viewer-roles";

const visible = (role: Role) =>
  [
    ...ADMIN_PAGES.filter((p) => canAccess(p, [role])).map((p) => p.to),
    ...CORE_PATH.filter((s) => canAccess(s, [role])).map((s) => s.to),
  ].sort();

const leadershipStep = CORE_PATH.find((s) => s.to === "/reports/leadership")!;

describe("college dean navigation", () => {
  it("shows the executive dashboard next to the reports centre", () => {
    const paths = visible("college_dean");
    expect(paths).toContain("/reports/leadership");
    expect(paths).toContain("/reports");
  });

  it("labels it as the college-scoped executive dashboard", () => {
    expect(coreStepLabel(leadershipStep, ["college_dean"]).label).toBe(
      COLLEGE_DEAN_LEADERSHIP_LABEL_AR,
    );
  });

  it("exposes no editing or operational tools", () => {
    const paths = visible("college_dean");
    for (const p of [
      "/schedule-builder",
      "/schedule-versions",
      "/teaching-assignments",
      "/courses",
      "/users",
      "/instructors",
      "/import",
      "/my-college",
    ]) {
      expect(paths).not.toContain(p);
    }
  });

  it("keeps super_admin and university_leadership labels unchanged", () => {
    expect(coreStepLabel(leadershipStep, ["super_admin"]).label).toBe(leadershipStep.label);
    expect(coreStepLabel(leadershipStep, ["university_leadership"]).label).toBe(
      leadershipStep.label,
    );
    expect(visible("super_admin")).toContain("/schedule-builder");
    expect([...new Set(visible("university_leadership"))].sort()).toEqual([
      "/reports",
      "/reports/leadership",
    ]);
  });
});

describe("college dean greeting", () => {
  it("names the dean and the assigned college", () => {
    expect(
      buildAccountGreeting({
        fullName: " د. أحمد ",
        collegeName: "الشريعة والقانون",
        isCollegeDeanOnly: true,
      }),
    ).toBe("مرحبًا، د. أحمد — عميد كلية الشريعة والقانون");
  });

  it("falls back safely without an assignment and never names another college", () => {
    expect(
      buildAccountGreeting({ fullName: "د. أحمد", collegeName: null, isCollegeDeanOnly: true }),
    ).toBe("مرحبًا، د. أحمد");
    expect(
      buildAccountGreeting({ fullName: null, collegeName: "", isCollegeDeanOnly: true }),
    ).toBe("مرحبًا بك");
  });

  it("leaves other roles' greeting untouched", () => {
    expect(
      buildAccountGreeting({ fullName: "المدير", collegeName: "الآداب", isCollegeDeanOnly: false }),
    ).toBe("مرحبًا، المدير");
  });
});

describe("access stays server-enforced and college-scoped", () => {
  const migration = readFileSync(
    "supabase/migrations/20260922090100_college_dean_leadership_scope.sql",
    "utf8",
  );
  it("derives the dean scope from auth identity and rejects other colleges", () => {
    expect(migration).toMatch(/has_role\(v_actor, 'college_dean'/);
    expect(migration).toMatch(/COLLEGE_SCOPE_VIOLATION/);
    expect(migration).toMatch(/COLLEGE_DEAN_REQUIRES_EXACTLY_ONE_COLLEGE/);
  });
  it("reads the college name from the trusted assignment, not metadata", () => {
    const layout = readFileSync("src/components/app-layout.tsx", "utf8");
    expect(layout).toMatch(/collegeName: activeCollege\?\.name/);
    expect(layout).not.toMatch(/user_metadata/);
  });
});
