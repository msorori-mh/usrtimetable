import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("final closure regressions", () => {
  test("published schedule filters hydrate relationships explicitly", () => {
    const source = read("src/routes/_authenticated/published-schedules.tsx");

    expect(source.includes("course_offerings!inner(program_id")).toBe(false);
    expect(source.includes('.select("schedule_version_id, course_offering_id")')).toBe(true);
    expect(source.includes('.select("id, program_id, course_id")')).toBe(true);
    expect(source.includes('.select("id, department_id")')).toBe(true);
    expect(source.includes("offeringsById")).toBe(true);
    expect(source.includes("departmentsByCourseId")).toBe(true);
  });

  test("mobile-wide content is contained by local responsive wrappers", () => {
    const versions = read("src/routes/_authenticated/schedule-versions.tsx");
    const unscheduled = read("src/routes/_authenticated/reports.unscheduled.tsx");
    const reportShell = read("src/components/reports/report-shell.tsx");
    const reportSection = read("src/components/reports/report-section.tsx");

    expect(
      versions.includes('className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto"'),
    ).toBe(true);
    expect(versions.includes('className="min-w-0 space-y-2 overflow-hidden p-4"')).toBe(true);
    // Containment now lives in the shared report primitives: the section card clips,
    // the data table scrolls locally, and every table keeps a min-width floor.
    expect(unscheduled.includes('bodyClassName="p-0"')).toBe(true);
    expect(unscheduled.includes("<ReportDataTable")).toBe(true);
    expect(reportSection.includes('cn("min-w-0 overflow-hidden", className)')).toBe(true);
    expect(reportSection.includes("report-data-table min-w-0 max-h-[70vh] overflow-auto")).toBe(
      true,
    );
    expect(reportSection.includes('minWidthClassName = "min-w-[720px]"')).toBe(true);
    expect(reportShell.includes("report-print-root min-w-0 space-y-4")).toBe(true);
    expect(reportShell.includes("flex min-w-0 flex-wrap items-center justify-end gap-2")).toBe(
      true,
    );
  });
});
