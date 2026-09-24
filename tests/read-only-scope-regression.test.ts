import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { ADMIN_PAGES, CORE_PATH, LEGACY_ADMIN_PAGES, canAccess, type Role } from "@/lib/admin-nav";
import { isReportsOnlyRole, resolveReportsOnlyRedirect } from "@/lib/viewer-roles";

const READ_ONLY: Role[] = ["read_only"];
const flags = { isReadOnly: true };

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("read_only («مشاهد») is reports-only — regression", () => {
  test("the authenticated layout actually mounts ReportsOnlyGate around <Outlet />", () => {
    const src = read("src/routes/_authenticated/route.tsx");
    expect(src).toContain('import { ReportsOnlyGate } from "@/components/reports-only-gate"');
    const gate = src.match(/<ReportsOnlyGate>[\s\S]*?<\/ReportsOnlyGate>/);
    expect(gate).not.toBeNull();
    expect(gate![0]).toContain("<Outlet />");
  });

  test("no authenticated route bypasses the gate with its own Outlet render", () => {
    const src = read("src/routes/_authenticated/route.tsx");
    // Exactly one <Outlet /> in the gated layout, inside the gate.
    expect(src.match(/<Outlet \/>/g)?.length).toBe(1);
  });

  test("gate redirects read_only away from operational routes", () => {
    for (const path of [
      "/schedule-builder",
      "/auto-schedule",
      "/schedule-versions",
      "/published-schedules",
      "/users",
      "/",
    ]) {
      expect(resolveReportsOnlyRedirect(flags, path)).toBe("/reports");
    }
    expect(resolveReportsOnlyRedirect(flags, "/reports")).toBeNull();
    expect(resolveReportsOnlyRedirect(flags, "/reports/instructor-schedule")).toBeNull();
  });

  test("navigation for read_only exposes reports entries only", () => {
    const pages = ADMIN_PAGES.filter((p) => canAccess(p, READ_ONLY)).map((p) => p.to);
    expect(pages).toEqual(["/reports"]);

    const steps = CORE_PATH.filter((s) => canAccess(s, READ_ONLY)).map((s) => s.to);
    expect(steps).toEqual(["/reports"]);

    const legacy = LEGACY_ADMIN_PAGES.filter((p) => canAccess(p, READ_ONLY)).map((p) => p.to);
    expect(legacy.filter((to) => !to.startsWith("/reports"))).toEqual([]);
  });

  test("schedule-builder is never reachable in nav for read_only", () => {
    const builder = ADMIN_PAGES.find((p) => p.to === "/schedule-builder");
    expect(builder).toBeDefined();
    expect(builder!.roles).not.toContain("read_only");
    expect(canAccess(builder!, READ_ONLY)).toBe(false);
  });

  test("app layout drives the reports-only nav from isReportsOnlyRole", () => {
    const src = read("src/components/app-layout.tsx");
    expect(src).toContain("isReportsOnlyRole(user)");
    expect(src).toContain('reportsOnly ? "core" : academicAffairs ? "all" : mode');
  });

  test("reports-only on /reports does not see the active-college badge", () => {
    const src = read("src/components/app-layout.tsx");
    // The badge is rendered only when activeCollege exists AND the reports-only-on-reports condition is false.
    expect(src).toContain(
      '!(reportsOnly && (pathname === "/reports" || pathname === "/reports/"))',
    );
    // Breadcrumb remains independent of the badge.
    expect(src).toMatch(/\{crumb \? \(/);
  });
});
