import { describe, expect, test } from "bun:test";
import {
  ALL_FILTER,
  EMPTY_COURSE_FILTERS,
  courseComposition,
  courseMatchesSearch,
  courseIdsForProgram,
  courseResultsLabelAr,
  compositionFromComponents,
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

describe("production regression: program/plan membership without course_programs rows", () => {
  const plans = [
    { id: "plan-l1", program_id: "cyber" },
    { id: "plan-l2", program_id: "cyber" },
    { id: "plan-other", program_id: "it" },
  ];
  const planCourses = [
    { id: "pc1", study_plan_id: "plan-l1", course_id: "c1" },
    { id: "pc2", study_plan_id: "plan-l1", course_id: "c2" },
    { id: "pc3", study_plan_id: "plan-l2", course_id: "c3" },
    { id: "pc4", study_plan_id: "plan-other", course_id: "c3" },
  ];

  test("program ids fall back to plan membership when course_programs is empty", () => {
    const ids = courseIdsForProgram({
      programId: "cyber",
      coursePrograms: [],
      planCourses,
      plans,
    });
    expect([...ids].sort()).toEqual(["c1", "c2", "c3"]);
  });

  test("both sources are unioned when course_programs has rows", () => {
    const ids = courseIdsForProgram({
      programId: "cyber",
      coursePrograms: [{ course_id: "c9", program_id: "cyber" }],
      planCourses,
      plans,
    });
    expect(ids.has("c9")).toBe(true);
    expect(ids.has("c1")).toBe(true);
  });

  test("IT dept + cyber program + level-1 plan + theory only returns the plan courses", () => {
    const result = filterCourses(
      rows,
      {
        ...EMPTY_COURSE_FILTERS,
        deptFilter: "d1",
        progFilter: "cyber",
        planFilter: "plan-l1",
        composition: "theory_only",
      },
      {
        programCourseIds: courseIdsForProgram({
          programId: "cyber",
          coursePrograms: [],
          planCourses,
          plans,
        }),
        planCourseIds: new Set(["c1", "c2"]),
        compositionByCourseId: new Map([
          ["c1", "theory_only"],
          ["c2", "theory_practical"],
        ]),
      },
    );
    expect(result.map((r) => r.id)).toEqual(["c1"]);
  });

  test("plan components decide composition, not the course's own hours", () => {
    // c1 stores theory+practical hours but the selected plan has theory only.
    expect(compositionFromComponents(["theory"])).toBe("theory_only");
    expect(compositionFromComponents(["theory", "practical"])).toBe("theory_practical");
    expect(compositionFromComponents(["practical"])).toBe("practical_only");
    expect(compositionFromComponents(["tutorial"])).toBe("theory_only");
    expect(compositionFromComponents([])).toBeNull();
  });

  test("shared course keeps each plan's own composition", () => {
    const perPlan = new Map<string, string[]>([
      ["pc3", ["theory"]],
      ["pc4", ["theory", "practical"]],
    ]);
    expect(compositionFromComponents(perPlan.get("pc3")!)).toBe("theory_only");
    expect(compositionFromComponents(perPlan.get("pc4")!)).toBe("theory_practical");
  });

  test("switching program drops a plan that no longer belongs to it", () => {
    const plansForProgram = plans.filter((p) => p.program_id === "it");
    const stale = "plan-l1";
    const effective = plansForProgram.some((p) => p.id === stale) ? stale : ALL_FILTER;
    expect(effective).toBe(ALL_FILTER);
    const result = filterCourses(rows, { ...EMPTY_COURSE_FILTERS, planFilter: effective });
    expect(result).toHaveLength(rows.length);
  });
});
