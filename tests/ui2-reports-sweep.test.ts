/**
 * Wave-2 UI-2 regression checks for the reports / print-center area.
 *
 * Source-level guards (fail on the pre-fix tree): Latin-digit formatting through
 * format.ts (L-13), logical RTL classes (M-16), no native confirm (M-15), no raw
 * error text in toasts (L-5), no unpaginated big-table reads (H-10), unused ui
 * wrappers removed and recharts lazy-loaded (M-18), owned route files <= 900
 * lines (L-14). A behavioural test drives attachIntakePresentation against a fake
 * PostgREST client to prove source rows are paginated and id lists chunked.
 */
import { describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { scanSource } from "../scripts/check-unbounded-selects.mjs";

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs)) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

const NOT_OWNED = /(physical-rooms|teaching-pay|\/export|\/read-all)\.ts$/;
const routes = readdirSync(join(ROOT, "src/routes/_authenticated"))
  .filter((f) => /^reports.*\.tsx$/.test(f) && f !== "reports.published-timetable.tsx")
  .map((f) => `src/routes/_authenticated/${f}`);
const OWNED = [
  ...routes,
  "src/routes/verify-report.tsx",
  "src/routes/_authenticated/timetable_.$versionId.print.tsx",
  ...walk("src/components/reports"),
  ...walk("src/components/print-center"),
  ...walk("src/lib/print-center"),
  ...walk("src/lib/existing-schedules"),
  ...walk("src/lib/schedule-quality-analytics"),
  ...walk("src/hooks/reports"),
  ...walk("src/lib/reports").filter((f) => !NOT_OWNED.test(f)),
];

function offenders(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of OWNED) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

describe("reports sweep (UI-2)", () => {
  test("L-13: no direct locale formatting; format.ts helpers only", () => {
    expect(
      offenders(
        /toLocale(String|DateString|TimeString|LowerCase|UpperCase)|Intl\.(NumberFormat|DateTimeFormat)/,
      ),
    ).toEqual([]);
  });

  test("M-16: no physical direction utility classes", () => {
    expect(
      offenders(
        /(^|[\s"'`])-?(ml|mr|pl|pr)-[\d[]|(^|[\s"'`])-?(left|right)-\d|text-(left|right)\b|rounded-(l|r)-|(^|[\s"'`])border-(l|r)(?=[\s"'`-])/,
      ),
    ).toEqual([]);
  });

  test("M-15: no native confirm()", () => {
    expect(offenders(/(^|[^.\w])confirm\(|window\.confirm\(/)).toEqual([]);
  });

  test("M-15: voiding a teaching-pay draft asks first", () => {
    const src = read("src/components/reports/teaching-pay-report.tsx");
    const at = src.indexOf('mutate("void"');
    expect(at).toBeGreaterThan(0);
    const before = src.slice(Math.max(0, at - 900), at);
    expect(before).toContain("confirmAction(");
    expect(before).toContain("destructive: true");
  });

  test("L-5: toasts never show raw error messages", () => {
    expect(
      offenders(
        /toast\.error\([^)]*(\(e(rr|rror)? as Error\)\.message|String\(e(rr|rror)?\)|error\.message)/,
      ),
    ).toEqual([]);
  });

  test("H-10: no unpaginated big-table reads in owned files", () => {
    const hits = OWNED.flatMap((file) =>
      scanSource(read(file)).map(
        (o: { table: string; line: number }) => `${file}:${o.line} ${o.table}`,
      ),
    );
    expect(hits).toEqual([]);
  });

  test("L-14: owned route files stay under 900 lines", () => {
    const big = routes.filter((f) => read(f).split("\n").length > 900);
    expect(big).toEqual([]);
  });

  test("L-14: role checks use the roles helpers", () => {
    expect(
      offenders(
        // Only app (user) role names; other `role` fields (e.g. a publication role "source") are not role checks.
        /roles?\.includes\(\s*"(super_admin|college_admin|read_only|institutional_viewer|university_leadership|college_dean)"\s*\)|role\s*===\s*"(super_admin|college_admin|read_only|institutional_viewer|university_leadership|college_dean)"/,
      ),
    ).toEqual([]);
  });
});

describe("M-18: unused ui wrappers removed, recharts lazy", () => {
  const removed = [
    "alert",
    "aspect-ratio",
    "avatar",
    "breadcrumb",
    "calendar",
    "carousel",
    "context-menu",
    "drawer",
    "form",
    "hover-card",
    "input-otp",
    "menubar",
    "navigation-menu",
    "pagination",
    "radio-group",
    "resizable",
    "scroll-area",
    "sidebar",
    "slider",
    "toggle-group",
    "toggle",
  ];

  test("deleted wrappers are gone and nothing imports them", () => {
    const present = removed.filter((n) => existsSync(join(ROOT, `src/components/ui/${n}.tsx`)));
    expect(present).toEqual([]);
    const importers: string[] = [];
    for (const file of walk("src")) {
      const src = read(file);
      for (const n of removed) {
        if (new RegExp(`components/ui/${n}["']`).test(src)) importers.push(`${file} -> ${n}`);
      }
    }
    expect(importers).toEqual([]);
  });

  test("rooms report loads the recharts panels lazily", () => {
    const route = read("src/routes/_authenticated/reports.rooms-report.tsx");
    expect(route).not.toMatch(/import \{ RoomsAnalyticsDashboard \}/);
    expect(route).not.toMatch(/import \{ RoomsDecisionsPanel \}/);
    expect(route).toMatch(
      /lazy\(\(\) =>\s*import\("@\/components\/reports\/rooms-analytics-dashboard"\)/,
    );
    expect(route).toMatch(
      /lazy\(\(\) =>\s*import\("@\/components\/reports\/rooms-decisions-panel"\)/,
    );
    expect(route).toContain("<Suspense");
    const recharts = walk("src").filter((f) => /from "recharts"/.test(read(f)));
    expect(recharts.sort()).toEqual([
      "src/components/reports/rooms-analytics-dashboard.tsx",
      "src/components/reports/rooms-decisions-panel.tsx",
      "src/components/ui/chart.tsx",
    ]);
  });
});

/* ---------- behavioural: attachIntakePresentation pages and chunks ---------- */

type Row = Record<string, unknown>;
const calls: { table: string; inSize: number; range: [number, number] | null }[] = [];

function fakeTable(table: string, rows: Row[]) {
  const filters: { col: string; values: unknown[] }[] = [];
  let range: [number, number] | null = null;
  const builder = {
    select: () => builder,
    order: () => builder,
    eq: () => builder,
    in: (col: string, values: unknown[]) => {
      filters.push({ col, values });
      return builder;
    },
    range: (from: number, to: number) => {
      range = [from, to];
      return builder;
    },
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) => {
      const matched = rows.filter((r) => filters.every((f) => f.values.includes(r[f.col])));
      calls.push({ table, inSize: filters[0]?.values.length ?? 0, range });
      // PostgREST caps an unranged response at 1000 rows.
      const page = range ? matched.slice(range[0], range[1] + 1) : matched.slice(0, 1000);
      return Promise.resolve({ data: page, error: null }).then(resolve);
    },
  };
  return builder;
}

const SESSIONS = Array.from({ length: 120 }, (_, i) => `s${String(i).padStart(3, "0")}`);
// Merged lectures: 12 source rows per session -> 1440 rows (> one page).
const SOURCE_ROWS: Row[] = SESSIONS.flatMap((sid, i) =>
  Array.from({ length: 12 }, (_, k) => ({
    id: `${sid}-${k}`,
    source_id: `${sid}-${k}`,
    schedule_session_id: sid,
    cohort_id: `c${(i * 12 + k) % 300}`,
    delivery_group_id: `g${k}`,
    study_plan_id: "plan",
    instructor_ids: [`ins${k}`],
    pending_reasons: [],
    shared_member: k > 0,
    raw_room: "A1",
  })),
);
const COHORTS: Row[] = Array.from({ length: 300 }, (_, i) => ({
  id: `c${i}`,
  program_id: "p1",
  level_id: "l1",
}));
const TABLES: Record<string, Row[]> = {
  existing_schedule_source_rows: SOURCE_ROWS,
  academic_cohorts: COHORTS,
  instructors: Array.from({ length: 12 }, (_, k) => ({ id: `ins${k}`, full_name: `محاضر ${k}` })),
  academic_programs: [{ id: "p1", name: "برنامج", department_id: "d1" }],
  academic_levels: [{ id: "l1", name: "المستوى الأول" }],
  departments: [{ id: "d1", name: "قسم" }],
};

mock.module("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => fakeTable(table, TABLES[table] ?? []) },
}));

describe("H-10: attachIntakePresentation", () => {
  test("reads every source row and chunks id filters", async () => {
    const { attachIntakePresentation } = await import("../src/lib/existing-schedules/report-data");
    const rows = SESSIONS.map((id) => ({ id })) as never[];
    const out = (await attachIntakePresentation(rows)) as unknown as Array<{
      id: string;
      intake_memberships: unknown[];
      shared_cohort_ids: string[];
    }>;
    // Every session keeps all 12 attending cohorts (none lost to the 1000-row cap).
    expect(out.every((r) => r.intake_memberships.length === 12)).toBe(true);
    expect(out.every((r) => r.shared_cohort_ids.length === 12)).toBe(true);
    // Source rows were range-paginated, and no `.in()` list exceeded 100 ids.
    const sourceCalls = calls.filter((c) => c.table === "existing_schedule_source_rows");
    expect(sourceCalls.every((c) => c.range !== null)).toBe(true);
    expect(sourceCalls.length).toBeGreaterThan(2);
    expect(calls.every((c) => c.inSize <= 100)).toBe(true);
    expect(calls.filter((c) => c.table === "academic_cohorts").length).toBe(3);
  });
});
