import { describe, expect, it } from "bun:test";
import {
  buildDeliveryGroupCoverage,
  coverageExportRows,
  coverageFilterOption,
  coverageSummaryText,
  UNSCHEDULED_BADGE_AR,
  type DeliveryGroupCatalogRow,
} from "../src/lib/reports/program-timetable-coverage";

/**
 * Regression fixture modelled on the reported CYB-L1-2026 case:
 * 9 active non-obsolete delivery groups, only 3 placed in the selected version,
 * 20 required weekly hours of which 6 are scheduled and 14 are not.
 */
function group(i: number, requiredHours: number): DeliveryGroupCatalogRow {
  return {
    id: `dg-${i}`,
    cohortId: "cyb-l1-2026",
    groupCode: `G${i}`,
    groupNumber: i,
    componentType: i % 2 === 0 ? "practical" : "theory",
    courseCode: `CYB10${i}`,
    courseName: `مقرر ${i}`,
    expectedStudents: 30,
    requiredHours,
    instructorName: i === 9 ? null : `محاضر ${i}`,
  };
}

// 3 scheduled groups at 2h each = 6h, 6 unscheduled groups = 14h, total 20h.
const groups: DeliveryGroupCatalogRow[] = [
  group(1, 2),
  group(2, 2),
  group(3, 2),
  group(4, 3),
  group(5, 3),
  group(6, 2),
  group(7, 2),
  group(8, 2),
  group(9, 2),
];

const sessions = [
  { delivery_group_id: "dg-1", start_time: "08:00", end_time: "10:00" },
  { delivery_group_id: "dg-2", start_time: "10:00", end_time: "12:00" },
  { delivery_group_id: "dg-3", start_time: "12:00", end_time: "14:00" },
];

describe("delivery group coverage", () => {
  const coverage = buildDeliveryGroupCoverage({ groups, sessions });

  it("keeps every catalogue group, scheduled or not", () => {
    expect(coverage.rows).toHaveLength(9);
    expect(coverage.scheduled).toHaveLength(3);
    expect(coverage.unscheduled).toHaveLength(6);
  });

  it("reports honest hour totals", () => {
    expect(coverage.summary.requiredHours).toBe(20);
    expect(coverage.summary.scheduledHours).toBe(6);
    expect(coverage.summary.unscheduledHours).toBe(14);
    expect(coverage.summary.totalGroups).toBe(9);
    expect(coverage.summary.scheduledGroups).toBe(3);
    expect(coverage.summary.unscheduledGroups).toBe(6);
  });

  it("marks unscheduled groups in the filter options", () => {
    const option = coverageFilterOption(coverage.unscheduled[0]!);
    expect(option.name).toContain(UNSCHEDULED_BADGE_AR);
    const scheduledOption = coverageFilterOption(coverage.scheduled[0]!);
    expect(scheduledOption.name).not.toContain(UNSCHEDULED_BADGE_AR);
  });

  it("exports unscheduled rows with their status", () => {
    const rows = coverageExportRows(coverage.unscheduled);
    expect(rows).toHaveLength(6);
    expect(rows.every((r) => r.status === UNSCHEDULED_BADGE_AR)).toBe(true);
    expect(rows.some((r) => r.instructor === "")).toBe(true);
  });

  it("summarises completion in Arabic", () => {
    const text = coverageSummaryText(coverage.summary);
    expect(text).toContain("المجموعات المجدولة 3/9");
    expect(text).toContain("6");
    expect(text).toContain("14");
  });

  it("treats a fully scheduled scope as complete", () => {
    const full = buildDeliveryGroupCoverage({
      groups: [group(1, 2)],
      sessions: [{ delivery_group_id: "dg-1", start_time: "08:00", end_time: "10:00" }],
    });
    expect(full.summary.unscheduledGroups).toBe(0);
    expect(coverageSummaryText(full.summary)).toContain("لا توجد مجموعات غير مجدولة");
  });
});

describe("report route wiring", () => {
  const route = require("node:fs").readFileSync(
    "src/routes/_authenticated/reports.program-level-timetable.tsx",
    "utf8",
  ) as string;

  it("builds the delivery group filter from the catalogue, not sessions", () => {
    expect(route).toContain("fetchCohortDeliveryGroupCatalog");
    expect(route).toContain("coverage.rows.map(coverageFilterOption)");
  });

  it("exports the status column and unscheduled rows", () => {
    expect(route).toContain("PROGRAM_TIMETABLE_EXPORT_HEADERS");
    expect(route).toContain("unscheduledInView.map");
  });

  it("shows an explicit empty state for an unscheduled group", () => {
    expect(route).toContain("هذه المجموعة لم تُسكن في نسخة الجدول الحالية");
  });
});
