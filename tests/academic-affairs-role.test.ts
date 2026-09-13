import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import {
  ACADEMIC_AFFAIRS_ROLE_LABEL_AR,
  assignsAllColleges,
  isReportsOnlyPath,
  isReportsOnlyRole,
  requiresCollegeAssignment,
  resolveReportsOnlyRedirect,
  scopeCollegesForRole,
} from "../src/lib/academic-affairs-role";
import { ADMIN_PAGES, CORE_PATH, canAccess, type Role } from "../src/lib/admin-nav";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const migrations = () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(new URL(f, dir), "utf8"))
    .join("\n");
};
const VIEWER: Role[] = ["institutional_viewer"];

describe("academic affairs role identification", () => {
  test("viewer-only account is reports-only", () => {
    expect(isReportsOnlyRole({ isInstitutionalViewer: true })).toBe(true);
  });

  test("multi-role safety: super_admin / college_admin are never narrowed", () => {
    expect(isReportsOnlyRole({ isInstitutionalViewer: true, isSuperAdmin: true })).toBe(false);
    expect(isReportsOnlyRole({ isInstitutionalViewer: true, isCollegeAdmin: true })).toBe(false);
  });

  test("other roles and anonymous users are unaffected", () => {
    expect(isReportsOnlyRole({ isCollegeAdmin: true })).toBe(false);
    expect(isReportsOnlyRole(null)).toBe(false);
    expect(isReportsOnlyRole(undefined)).toBe(false);
  });
});

describe("reports-only path scope", () => {
  test("only /reports and /reports/* are inside the allowed area", () => {
    expect(isReportsOnlyPath("/reports")).toBe(true);
    expect(isReportsOnlyPath("/reports/instructor-workload")).toBe(true);
    expect(isReportsOnlyPath("/reports-archive")).toBe(false);
    expect(isReportsOnlyPath("/published-schedules")).toBe(false);
    expect(isReportsOnlyPath("/dashboard")).toBe(false);
  });

  test("/dashboard redirects to /reports for the role", () => {
    expect(resolveReportsOnlyRedirect({ isInstitutionalViewer: true }, "/dashboard")).toBe(
      "/reports",
    );
    expect(resolveReportsOnlyRedirect({ isInstitutionalViewer: true }, "/users")).toBe("/reports");
    expect(
      resolveReportsOnlyRedirect({ isInstitutionalViewer: true }, "/published-schedules"),
    ).toBe("/reports");
    expect(resolveReportsOnlyRedirect({ isInstitutionalViewer: true }, "/reports/conflicts")).toBe(
      null,
    );
  });

  test("no redirect for other roles", () => {
    expect(resolveReportsOnlyRedirect({ isCollegeAdmin: true }, "/dashboard")).toBe(null);
    expect(
      resolveReportsOnlyRedirect({ isSuperAdmin: true, isInstitutionalViewer: true }, "/users"),
    ).toBe(null);
  });
});

describe("navigation surface", () => {
  const colleges = [{ id: "a" }, { id: "b" }, { id: "c" }];

  test("the role sees exactly one core entry: reports", () => {
    const visible = CORE_PATH.filter((s) => canAccess(s, VIEWER)).map((s) => s.to);
    expect(visible).toEqual(["/reports"]);
  });

  test("operational admin pages are hidden from the role", () => {
    const visible = ADMIN_PAGES.filter((p) => canAccess(p, VIEWER)).map((p) => p.to);
    expect(visible).toEqual(["/reports"]);
    for (const hidden of ["/users", "/colleges", "/dashboard", "/import"]) {
      expect(visible).not.toContain(hidden);
    }
  });

  test("college_admin and read_only keep their existing pages", () => {
    expect(canAccess({ roles: ["super_admin", "college_admin"] }, ["college_admin"])).toBe(true);
    expect(ADMIN_PAGES.filter((p) => canAccess(p, ["read_only"])).length).toBeGreaterThan(10);
  });

  test("reports are scoped to assigned colleges only", () => {
    expect(scopeCollegesForRole(colleges, ["b"], true).map((c) => c.id)).toEqual(["b"]);
    expect(scopeCollegesForRole(colleges, ["a", "c"], true).map((c) => c.id)).toEqual(["a", "c"]);
    expect(scopeCollegesForRole(colleges, [], true)).toEqual([]);
    expect(scopeCollegesForRole(colleges, ["b"], false).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("account creation contract", () => {
  test("academic affairs is auto-assigned all colleges, not manually picked", () => {
    expect(assignsAllColleges("institutional_viewer")).toBe(true);
    expect(assignsAllColleges("college_admin")).toBe(false);
    expect(assignsAllColleges("read_only")).toBe(false);
    expect(assignsAllColleges("super_admin")).toBe(false);

    expect(requiresCollegeAssignment("institutional_viewer")).toBe(false);
    expect(requiresCollegeAssignment("college_admin")).toBe(true);
    expect(requiresCollegeAssignment("read_only")).toBe(true);
    expect(requiresCollegeAssignment("super_admin")).toBe(false);
  });

  test("server-side creation resolves every current college for academic affairs", () => {
    const src = read("src/lib/users.functions.ts");
    expect(src).toContain("assignsAllColleges(data.role)");
    expect(src).toContain('supabaseAdmin.from("colleges").select("id")');
    expect(src).toContain("requiresCollegeAssignment(data.role) && collegeIds.length === 0");
    expect(src).toContain('onConflict: "user_id,college_id", ignoreDuplicates: true');
  });

  test("the users screen shows no manual college picker for academic affairs", () => {
    const src = read("src/routes/_authenticated/users.tsx");
    expect(src).toContain("assignsAllColleges(form.role)");
    // The picker is rendered only for roles that need a manual assignment.
    expect(src).toContain("{requiresCollegeAssignment(form.role) && (");
  });

  test("creating academic affairs submits every current college id", () => {
    const src = read("src/routes/_authenticated/users.tsx");
    expect(src).toContain(
      "assignsAllColleges(form.role) ? colleges.map((c) => c.id) : form.college_ids",
    );
    expect(src).toContain("onCreate({ ...form, college_ids: collegeIds })");
  });

  test("granting the role to an existing user auto-assigns all colleges", () => {
    const src = read("src/routes/_authenticated/users.tsx");
    expect(src).toContain("if (assignsAllColleges(role as never)) {");
    expect(src).toContain('supabase.from("colleges").select("id")');
    expect(src).toContain('onConflict: "user_id,college_id", ignoreDuplicates: true');
  });

  test("role texts describe all colleges, reports only, no manual picking", () => {
    const src = read("src/lib/academic-affairs-role.ts");
    expect(src).toContain("إدارة الشؤون الأكاديمية");
    expect(src).toContain("جميع الكلّيات");
    expect(src).not.toContain("كلية واحدة على الأقل");
  });



  test("database triggers assign all colleges now and any college created later", () => {
    const sql = migrations();
    expect(sql).toMatch(
      /CREATE TRIGGER trg_assign_all_colleges_to_academic_affairs\s*\nAFTER INSERT ON public\.user_roles/,
    );
    expect(sql).toMatch(
      /CREATE TRIGGER trg_assign_new_college_to_academic_affairs\s*\nAFTER INSERT ON public\.colleges/,
    );
    // multi-role safety: an admin carrying the role is never auto-assigned.
    expect(sql).toContain("IF NOT public.is_academic_affairs_only(NEW.user_id) THEN");
    // backfill for accounts that already carry the role
    expect(sql).toMatch(/INSERT INTO public\.user_colleges[\s\S]*CROSS JOIN public\.colleges/);
    // the legacy, non-multi-role-safe duplicate is removed
    expect(sql).toContain(
      "DROP FUNCTION IF EXISTS public.assign_all_colleges_to_institutional_viewer()",
    );
  });
});

describe("user-facing wording and route enforcement", () => {
  test("old label is gone from the app source", () => {
    for (const f of [
      "src/components/app-layout.tsx",
      "src/routes/_authenticated/users.tsx",
      "src/routes/_authenticated/admin-tools.tsx",
    ]) {
      expect(read(f)).not.toContain("مشاهد مؤسسي");
      expect(read(f)).toContain("ACADEMIC_AFFAIRS_ROLE_LABEL_AR");
    }
    expect(ACADEMIC_AFFAIRS_ROLE_LABEL_AR).toBe("إدارة الشؤون الأكاديمية");
  });

  test("the authenticated layout wraps children in the scope gate", () => {
    const route = read("src/routes/_authenticated/route.tsx");
    expect(route).toContain("<ReportsOnlyGate>");
    const gate = read("src/components/reports-only-gate.tsx");
    expect(gate).toContain("resolveReportsOnlyRedirect");
    expect(gate).toContain("replace: true");
  });

  test("the reports hub hides the publishing link for the role", () => {
    const hub = read("src/routes/_authenticated/reports.index.tsx");
    expect(hub).toContain("{!reportsOnly && (");
    const idx = hub.indexOf('to="/published-schedules"');
    expect(idx).toBeGreaterThan(0);
    expect(hub.slice(idx - 400, idx)).toContain("!reportsOnly");
  });

  test("the sidebar hides the navigation-mode toggle and tools gateway", () => {
    const layout = read("src/components/app-layout.tsx");
    expect(layout).toContain("const modeToggle = reportsOnly ? null : (");
    const toolsIdx = layout.indexOf("to={ADMIN_TOOLS_PAGE.to}");
    expect(toolsIdx).toBeGreaterThan(0);
    expect(layout.slice(toolsIdx - 200, toolsIdx)).toContain("!reportsOnly");
    const mobileIdx = layout.indexOf('data-testid="mobile-navigation-mode-toggle"');
    expect(mobileIdx).toBeGreaterThan(0);
    expect(layout.slice(mobileIdx - 500, mobileIdx)).toContain("!reportsOnly");
    expect(layout).toContain('const effectiveMode: NavMode = reportsOnly ? "core" : mode;');
  });

  test("no write permission was widened", () => {
    const canManage = read("src/hooks/use-can-manage.ts");
    expect(canManage).not.toContain("institutional_viewer");
    expect(read("src/lib/academic-affairs-role.ts")).not.toContain("canManage");
  });
});
