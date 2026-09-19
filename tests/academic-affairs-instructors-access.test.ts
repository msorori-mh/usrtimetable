import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ADMIN_PAGES, canAccess } from "@/lib/admin-nav";
import {
  INSTITUTIONAL_VIEWER_ROLE_LABEL_AR,
  isAcademicAffairsRole,
  resolveViewerScopeRedirect,
} from "@/lib/viewer-roles";

const ACADEMIC = { isInstitutionalViewer: true } as const;

describe("academic affairs route scope", () => {
  it("allows reports and instructors only", () => {
    expect(isAcademicAffairsRole(ACADEMIC)).toBe(true);
    expect(resolveViewerScopeRedirect(ACADEMIC, "/reports")).toBeNull();
    expect(resolveViewerScopeRedirect(ACADEMIC, "/reports/instructors")).toBeNull();
    expect(resolveViewerScopeRedirect(ACADEMIC, "/instructors")).toBeNull();
    expect(resolveViewerScopeRedirect(ACADEMIC, "/dashboard")).toBe("/reports");
    expect(resolveViewerScopeRedirect(ACADEMIC, "/users")).toBe("/reports");
  });

  it("navigation exposes only instructors and reports", () => {
    const visible = ADMIN_PAGES.filter((p) => canAccess(p, ["institutional_viewer"])).map(
      (p) => p.to,
    );
    expect(visible).toContain("/instructors");
    expect(visible).toContain("/reports");
    expect(visible).not.toContain("/courses");
    expect(visible).not.toContain("/schedule-builder");
  });

  it("uses the academic-affairs label", () => {
    expect(INSTITUTIONAL_VIEWER_ROLE_LABEL_AR).toBe("إدارة الشؤون الأكاديمية");
  });
});

describe("instructor edit wiring", () => {
  const src = readFileSync("src/routes/_authenticated/instructors.tsx", "utf8");
  const migration = readFileSync(
    "supabase/migrations/20260915034500_academic_affairs_instructor_basic_edit.sql",
    "utf8",
  );

  it("uses a dedicated RPC for non-admin academic-affairs edits", () => {
    expect(src).toContain("useCanEditInstructorsActiveCollege");
    expect(src).toContain('"update_home_college_instructor"');
    expect(src).toContain("canEdit && i.can_edit");
  });

  it("keeps create/delete admin-only", () => {
    expect(src).toContain("صلاحيتك تسمح بتعديل المحاضرين الحاليين فقط");
    expect(src).toContain("{canManage && (");
    expect(src).toContain("حذف المحاضر؟");
  });

  it("migration whitelists the academic-affairs role without widening can_manage_college", () => {
    expect(migration).toContain("public.has_role(v_actor, 'institutional_viewer')");
    expect(migration).toContain("public.is_viewer_only(v_actor)");
    expect(migration).toContain("academic_affairs_update");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.can_manage_college");
  });
});

describe("instructor report", () => {
  const hub = readFileSync("src/routes/_authenticated/reports.index.tsx", "utf8");
  const report = readFileSync("src/routes/_authenticated/reports.instructors.tsx", "utf8");

  it("is linked from the report hub", () => {
    expect(hub).toContain("/reports/instructors");
    expect(hub).toContain("دليل المحاضرين وبياناتهم");
  });

  it("contains the requested basic data and edit handoff", () => {
    expect(report).toContain("رقم الموظف");
    expect(report).toContain("كلية التبعية");
    expect(report).toContain("قسم التبعية");
    expect(report).toContain("النصاب الفعلي");
    expect(report).toContain("البريد الإلكتروني");
    expect(report).toContain("تعديل بيانات المحاضرين");
  });
});
