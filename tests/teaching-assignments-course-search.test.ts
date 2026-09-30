import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { filterTeachingAssignmentRowsByCourse } from "@/lib/teaching-assignments/course-search";

const rows = [
  { id: "1", course_code: "CS101", course_name: "مبادئ البرمجة" },
  { id: "2", course_code: "MATH-2", course_name: "رياضيات متقطعة" },
  { id: "3", course_code: "AR101", course_name: "اللُّغة العربية" },
];

describe("teaching assignment course search", () => {
  it("matches a course by code or Arabic name", () => {
    expect(filterTeachingAssignmentRowsByCourse(rows, "cs101").map((row) => row.id)).toEqual(["1"]);
    expect(filterTeachingAssignmentRowsByCourse(rows, "متقطعه").map((row) => row.id)).toEqual([
      "2",
    ]);
    expect(filterTeachingAssignmentRowsByCourse(rows, "اللغه").map((row) => row.id)).toEqual(["3"]);
  });

  it("returns all rows for an empty search and none for a missing course", () => {
    expect(filterTeachingAssignmentRowsByCourse(rows, "")).toEqual(rows);
    expect(filterTeachingAssignmentRowsByCourse(rows, "مقرر غير موجود")).toEqual([]);
  });
});

describe("teaching assignment course-search wiring", () => {
  const route = readFileSync("src/routes/_authenticated/teaching-assignments.tsx", "utf8");
  const reportsHub = readFileSync("src/routes/_authenticated/reports.index.tsx", "utf8");
  const academicReport = readFileSync(
    "src/routes/_authenticated/reports.academic-affairs.tsx",
    "utf8",
  );

  it("renders the course search and composes it with instructor search and export", () => {
    expect(route).toContain('data-testid="ta-v2-course-search"');
    expect(route).toContain("اسم المقرر أو رمزه...");
    expect(route).toContain("filterTeachingAssignmentRowsByCourse");
    expect(route).toContain("filterRowsByInstructorName(courseRows, instructorSearch)");
    expect(route).toContain('label: "المقرر"');
  });

  it("links directly to the printable course assignment status report", () => {
    expect(route).toContain('report: "course_status"');
    expect(route).toContain("تقرير حالة الإسناد");
    expect(reportsHub).toContain("حالة إسناد المقررات");
    expect(reportsHub).toContain('search: { report: "course_status" }');
    expect(academicReport).toContain('data-testid="course-assignment-status-summary"');
    expect(academicReport).toContain("ابحث باسم المقرر أو رمزه");
  });
});
