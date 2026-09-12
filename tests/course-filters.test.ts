import { describe, expect, test } from "bun:test";
import {
  ALL_FILTER,
  EMPTY_COURSE_FILTERS,
  courseComposition,
  courseMatchesSearch,
  courseResultsLabelAr,
  creditHourOptions,
  filterCourses,
  hasActiveCourseFilters,
  programsForDepartment,
  type CourseFilterRow,
} from "@/lib/courses/course-filters";

const rows: CourseFilterRow[] = [
  {
    id: "c1",
    code: "CS111",
    name: "مقدمة في البرمجة",
    name_en: "Introduction to Programming",
    department_id: "d1",
    credit_hours: 3,
    theory_hours: 2,
    practical_hours: 2,
  },
  {
    id: "c2",
    code: "USR07",
    name: "مشروع أسبوعي",
    department_id: "d1",
    credit_hours: 2,
    theory_hours: 2,
    practical_hours: 0,
  },
  {
    id: "c3",
    code: "PHY201",
    name: "معمل الفيزياء",
    department_id: "d2",
    credit_hours: 1,
    theory_hours: 0,
    practical_hours: 2,
  },
];

describe("course search", () => {
  test("matches code case-insensitively and with trimming", () => {
    expect(courseMatchesSearch(rows[0]!, "  cs111 ")).toBe(true);
    expect(courseMatchesSearch(rows[1]!, "cs111")).toBe(false);
  });

  test("matches Arabic name and English name when present", () => {
    expect(courseMatchesSearch(rows[0]!, "برمجة")).toBe(true);
    expect(courseMatchesSearch(rows[0]!, "INTRODUCTION")).toBe(true);
    expect(courseMatchesSearch(rows[1]!, "programming")).toBe(false);
  });

  test("empty search keeps every row", () => {
    expect(filterCourses(rows, EMPTY_COURSE_FILTERS)).toHaveLength(3);
  });
});

describe("composition and credit hours", () => {
  test("derives composition from stored hours only", () => {
    expect(courseComposition(rows[0]!)).toBe("theory_practical");
    expect(courseComposition(rows[1]!)).toBe("theory_only");
    expect(courseComposition(rows[2]!)).toBe("practical_only");
  });

  test("credit hour options are distinct and ascending", () => {
    expect(creditHourOptions(rows)).toEqual([1, 2, 3]);
  });
});

describe("combined AND filtering", () => {
  test("search + department + composition + credit hours all apply", () => {
    const result = filterCourses(rows, {
      ...EMPTY_COURSE_FILTERS,
      search: "c",
      deptFilter: "d1",
      composition: "theory_practical",
      creditHours: "3",
    });
    expect(result.map((r) => r.id)).toEqual(["c1"]);
  });

  test("program and plan link sets narrow results", () => {
    const result = filterCourses(rows, EMPTY_COURSE_FILTERS, {
      programCourseIds: new Set(["c1", "c2"]),
      planCourseIds: new Set(["c2"]),
    });
    expect(result.map((r) => r.id)).toEqual(["c2"]);
  });

  test("no matches yields an empty list rather than all rows", () => {
    expect(filterCourses(rows, { ...EMPTY_COURSE_FILTERS, search: "لا يوجد" })).toEqual([]);
  });
});

describe("program filter follows department", () => {
  const programs = [
    { id: "p1", name: "حاسوب", department_id: "d1" },
    { id: "p2", name: "فيزياء", department_id: "d2" },
    { id: "p3", name: "عام", department_id: null },
  ];

  test("all departments keeps every program", () => {
    expect(programsForDepartment(programs, ALL_FILTER)).toHaveLength(3);
  });

  test("selected department keeps only its programs", () => {
    expect(programsForDepartment(programs, "d1").map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("clear filters and results label", () => {
  test("active state detection", () => {
    expect(hasActiveCourseFilters(EMPTY_COURSE_FILTERS)).toBe(false);
    expect(hasActiveCourseFilters({ ...EMPTY_COURSE_FILTERS, search: "  " })).toBe(false);
    expect(hasActiveCourseFilters({ ...EMPTY_COURSE_FILTERS, search: "cs" })).toBe(true);
    expect(hasActiveCourseFilters({ ...EMPTY_COURSE_FILTERS, creditHours: "3" })).toBe(true);
  });

  test("clearing restores the full list", () => {
    const cleared = { ...EMPTY_COURSE_FILTERS };
    expect(filterCourses(rows, cleared)).toHaveLength(rows.length);
    expect(hasActiveCourseFilters(cleared)).toBe(false);
  });

  test("results label is Arabic and counts both numbers", () => {
    expect(courseResultsLabelAr(1, 3)).toBe("عرض 1 من 3 مقرر");
  });
});
