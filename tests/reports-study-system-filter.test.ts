/**
 * REPORTS-STUDY-SYSTEM-01 — the «نظام الدراسة» filter must reach the query, not stay UI-only.
 *
 * Read-only regression: no scheduling data, versions, or assignments are touched.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { matchesStudySystem } from "@/lib/reports/filters";
import type { ReportStudySystem } from "@/lib/reports/types";

function read(path: string) {
  return readFileSync(path, "utf8");
}

const ROUTES_DIR = "src/routes/_authenticated";

/** Routes that render ReportFilters WITHOUT the study-system control are out of scope. */
function routesWithStudySystemFilter(): string[] {
  return readdirSync(ROUTES_DIR)
    .filter((f) => f.startsWith("reports.") && f.endsWith(".tsx"))
    .filter((f) => {
      const src = read(`${ROUTES_DIR}/${f}`);
      return src.includes("<ReportFilters") && !src.includes("studySystem={false}");
    })
    .map((f) => `${ROUTES_DIR}/${f}`);
}

describe("rooms-report honours ctx.studySystem", () => {
  const src = read(`${ROUTES_DIR}/reports.rooms-report.tsx`);

  test("session fetch passes the real filter value", () => {
    expect(src).toContain("studySystem: ctx.studySystem");
    expect(src).not.toContain('studySystem: "all"');
  });

  test("query key includes the study system so changing it refetches", () => {
    expect(src).toContain(
      '["rooms-report-sessions", ctx.collegeId, ctx.versionId, ctx.studySystem]',
    );
  });

  test("KPIs and summary state that numbers are within the active filter", () => {
    expect(src).toContain('ctx.studySystem !== "all"');
    expect(src).toContain("ضمن الفلتر");
  });
});

describe("current-timetable honours ctx.studySystem", () => {
  const src = read(`${ROUTES_DIR}/reports.current-timetable.tsx`);

  // The page has a «print scope» switch: "college" intentionally prints every study system
  // (the study-system control is hidden in that mode), "custom" honours ctx.studySystem.
  // effectiveStudySystem is therefore the real filter value and must reach the fetch.
  test("effective filter derives from ctx.studySystem outside whole-college scope", () => {
    expect(src).toContain(
      'const effectiveStudySystem = printScope === "college" ? "all" : ctx.studySystem;',
    );
    expect(src).toContain('studySystem={printScope === "custom"}');
  });

  // Since 31d0056 the version is read whole ("all") so merged lectures stored on an
  // anchor group of another study system still reach every attending cohort; the
  // filter is applied AFTER fetchStudentPrintMemberships expands rows to cohorts
  // (whose study_system then is the attending cohort's). Filtering at fetch time
  // would silently drop those merged lectures again.
  test("session rows are filtered by the real filter value after cohort expansion", () => {
    expect(src).toMatch(
      /fetchStudentPrintMemberships\([\s\S]*?\)\s*\)\.filter\([\s\S]*?row\.study_system === effectiveStudySystem/,
    );
    expect(src).toContain("studySystem: effectiveStudySystem");
  });

  test("query key includes the study system", () => {
    expect(src).toContain(
      '["current-timetable-print", ctx.collegeId, ctx.versionId, effectiveStudySystem]',
    );
  });

  test("coverage KPIs are labelled as all-systems and filtered counts as within-filter", () => {
    expect(src).toContain("كل الأنظمة");
    expect(src).toContain("ضمن الفلتر");
  });
});

describe("audit: no report route with the study-system filter hardcodes all", () => {
  test("every such route threads ctx.studySystem into its session reads", () => {
    const offenders: string[] = [];
    for (const path of routesWithStudySystemFilter()) {
      const src = read(path);
      // A whole-version read is allowed only when the rows are narrowed by the active
      // study system after merged-lecture expansion (see current-timetable above).
      const postFiltered =
        src.includes("fetchStudentPrintMemberships(") &&
        /row\.study_system === (ctx\.studySystem|effectiveStudySystem)/.test(src);
      if (/studySystem:\s*"all"/.test(src) && !postFiltered) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });

  test("the audit actually covers the two affected pages", () => {
    const paths = routesWithStudySystemFilter();
    expect(paths).toContain(`${ROUTES_DIR}/reports.rooms-report.tsx`);
    expect(paths).toContain(`${ROUTES_DIR}/reports.current-timetable.tsx`);
  });
});

describe("study-system semantics: regular / parallel / all with both counted in each", () => {
  const fixture = [
    { id: "s1", study_system: "regular", hours: 2 },
    { id: "s2", study_system: "regular", hours: 1 },
    { id: "s3", study_system: "parallel", hours: 3 },
    { id: "s4", study_system: "both", hours: 2 },
    { id: "s5", study_system: null, hours: 1 },
  ];

  function scope(filter: ReportStudySystem) {
    const rows = fixture.filter((s) => matchesStudySystem(s.study_system, filter));
    return { count: rows.length, hours: rows.reduce((sum, r) => sum + r.hours, 0) };
  }

  test("each value yields different counts and hours", () => {
    expect(scope("all")).toEqual({ count: 5, hours: 9 });
    expect(scope("regular")).toEqual({ count: 4, hours: 6 });
    expect(scope("parallel")).toEqual({ count: 2, hours: 5 });
  });

  test("«both» sessions appear in regular and parallel (current project contract)", () => {
    expect(matchesStudySystem("both", "regular")).toBe(true);
    expect(matchesStudySystem("both", "parallel")).toBe(true);
    expect(matchesStudySystem(null, "regular")).toBe(true);
    expect(matchesStudySystem(null, "parallel")).toBe(false);
  });

  test("database values stay latin — no Arabic study-system codes in the filter helper", () => {
    const helper = read("src/lib/reports/filters.ts");
    const applied = helper.match(/applyStudySystemFilter[\s\S]*?\n}/)![0];
    expect(applied).toContain('"regular", "both"');
    expect(applied).toContain('"parallel", "both"');
    expect(/[\u0600-\u06FF]/.test(applied)).toBe(false);
  });
});
