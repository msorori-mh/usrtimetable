/**
 * REPORTS-COLLEGE-SWITCH-01 — a reports-only account («مشاهد» / read_only) with
 * all assigned colleges must be able to switch the active college from inside
 * /reports. Proves: the layout mounts the switch, the shell no longer duplicates
 * it, scoping returns every assigned college, the store broadcasts the change,
 * and the report context drops the previous college's term/version.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { scopeCollegesForRole, isViewerOnlyRole } from "../src/lib/viewer-roles";
import {
  setActiveCollegeId,
  subscribeActiveCollegeId,
  getActiveCollegeId,
  resolveActiveCollege,
} from "../src/lib/active-college-store";

// The store is a browser module; give it a minimal window/localStorage.
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window ??= {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as Record<string, unknown>).localStorage ??= (
  globalThis as unknown as { window: { localStorage: unknown } }
).window.localStorage;

const read = (p: string) => readFileSync(p, "utf8");
const LAYOUT = "src/routes/_authenticated/reports.tsx";
const BAR = "src/components/reports/reports-college-bar.tsx";
const SHELL = "src/components/reports/report-shell.tsx";
const CTX = "src/hooks/reports/useReportContext.ts";

describe("reports college switcher wiring", () => {
  test("the /reports layout renders the college bar above the outlet", () => {
    const src = read(LAYOUT);
    expect(src).toContain("ReportsCollegeBar");
    expect(src).toContain("<Outlet />");
    expect(src.indexOf("<ReportsCollegeBar />")).toBeLessThan(src.indexOf("<Outlet />"));
  });

  test("the bar reads accessible colleges from the shared hook, never a hardcoded list", () => {
    const src = read(BAR);
    expect(src).toContain("useActiveCollege");
    expect(src).toContain("colleges.map");
    expect(src).toContain("الكلية");
    // single college → plain label, several → a labelled Select
    expect(src).toContain("colleges.length === 1");
    expect(src).toContain("اختيار الكلية للتقارير");
    expect(src).toContain("entityDisplayName(c)");
    expect(src).not.toContain("${c.name} — ${c.code}");
    expect(src).not.toMatch(/تكنولوجيا المعلومات/);
  });

  test("the report shell no longer duplicates the switch", () => {
    expect(read(SHELL)).not.toContain("CollegeSwitcher");
  });

  test("changing the college resets term and version in the report context", () => {
    const src = read(CTX);
    expect(src).toContain("lastCollegeId");
    expect(src).toContain("setTermIdState(null)");
    expect(src).toContain("setVersionIdState(null)");
  });
});

describe("read_only with all colleges assigned", () => {
  const colleges = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i + 1}`,
    name: `كلية ${i + 1}`,
    code: `C${i + 1}`,
    university_id: "u1",
  }));

  test("a read_only account is viewer-only and keeps all 8 assigned colleges", () => {
    const viewerOnly = isViewerOnlyRole({
      isSuperAdmin: false,
      isCollegeAdmin: false,
      isReadOnly: true,
      isInstitutionalViewer: false,
    });
    expect(viewerOnly).toBe(true);
    const scoped = scopeCollegesForRole(
      colleges,
      colleges.map((c) => c.id),
      viewerOnly,
    );
    expect(scoped).toHaveLength(8);
  });

  test("switching broadcasts the new active college id to subscribers", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeActiveCollegeId(() => seen.push(getActiveCollegeId()));
    setActiveCollegeId("c5");
    setActiveCollegeId("c8");
    unsubscribe();
    expect(seen).toEqual(["c5", "c8"]);
    expect(resolveActiveCollege(colleges, getActiveCollegeId())?.id).toBe("c8");
  });
});
