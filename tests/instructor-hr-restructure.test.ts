import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TEMPLATES } from "../src/lib/excel-import/templates";
import { instructorHeader, prepareInstructorRow } from "../src/lib/excel-import/instructor-sheet";
import {
  effectiveInstructorWeeklyHours,
  isHourlyContractTypeCode,
} from "../src/lib/instructors/effective-hours";
import {
  ADMINISTRATIVE_POSITION_OPTIONS,
  normalizeAdministrativePosition,
  requiresAdministrativeDepartment,
} from "../src/lib/instructors/administrative-positions";
import { preflightCanonicalTeachingHours } from "../src/lib/excel-import/teaching-assignments-v2-hours-preflight";

const root = resolve(import.meta.dir, "..");
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("instructor HR form contract", () => {
  test("form exposes the requested order and hourly-contract conditionals", () => {
    const src = source("src/routes/_authenticated/instructors.tsx");
    const tokens = [
      'data-field-order="1-category"',
      'data-field-order="2-employee-number"',
      'data-field-order="3-default-name"',
      'data-field-order="4-full-arabic-name"',
      'data-field-order="5-affiliation-college"',
      'data-field-order="6-affiliation-department"',
      'data-field-order="7-specialization"',
      'data-field-order="8-rank"',
      'data-field-order="9-base-quota"',
      'data-field-order="10-admin-release"',
      'data-field-order="11-administrative-position"',
      'data-field-order="12-employment"',
      'data-field-order="13-email"',
      'data-field-order="14-phone"',
      'data-field-order="15-active"',
    ];
    let previous = -1;
    for (const token of tokens) {
      const index = src.indexOf(token);
      expect(index).toBeGreaterThan(previous);
      previous = index;
    }
    expect(src).toContain("!hourlyContract && (");
    expect(src).toContain("instructor-affiliation-depts");
    expect(src).toContain('.eq("college_id", affiliationCollegeId)');
    expect(src).not.toContain("الاسم بالإنجليزية</Label>");
    expect(src).not.toContain("ملاحظات</Label>");
  });

  test("administrative position list and department-head rule are structured", () => {
    expect(ADMINISTRATIVE_POSITION_OPTIONS.map((p) => p.value)).toEqual([
      "department_head",
      "vice_dean_academic",
      "vice_dean_student_affairs",
      "dean",
    ]);
    expect(normalizeAdministrativePosition("رئيس قسم")).toBe("department_head");
    expect(requiresAdministrativeDepartment("department_head")).toBe(true);
    expect(requiresAdministrativeDepartment("dean")).toBe(false);
  });
});

describe("effective weekly quota", () => {
  test("subtracts administrative release and clamps at zero", () => {
    expect(effectiveInstructorWeeklyHours(18, 4)).toBe(14);
    expect(effectiveInstructorWeeklyHours(18, 0)).toBe(18);
    expect(effectiveInstructorWeeklyHours(10, 20)).toBe(0);
  });
  test("recognizes the production hourly-contract category", () => {
    expect(isHourlyContractTypeCode("con")).toBe(true);
    expect(isHourlyContractTypeCode("CON")).toBe(true);
    expect(isHourlyContractTypeCode("permanent")).toBe(false);
  });
});

describe("official instructor import template", () => {
  test("emits exactly the new sixteen visible columns in order", () => {
    const keys = TEMPLATES.instructors.columns.filter((c) => !c.templateHidden).map((c) => c.key);
    expect(keys).toEqual([
      "instructor_type_code",
      "employee_number",
      "full_name",
      "full_name_ar",
      "affiliation_college_code",
      "affiliation_department_code",
      "specialization",
      "academic_rank",
      "max_weekly_hours",
      "administrative_release_hours",
      "administrative_position",
      "administrative_department_code",
      "employment_type",
      "email",
      "phone",
      "is_active",
    ]);
  });

  test("legacy basic headers remain recognized", () => {
    expect(instructorHeader("اسم المدرس", TEMPLATES.instructors.columns)).toBe("الاسم_الافتراضي");
    expect(instructorHeader("نوع_المحاضر_رمز", TEMPLATES.instructors.columns)).toBe(
      "فئة_المحاضر_رمز",
    );
    expect(instructorHeader("رمز_القسم", TEMPLATES.instructors.columns)).toBe("رمز_القسم");
  });

  test("hourly contractor may omit employee number; normal employee may not", () => {
    const conRow = {
      rowNumber: 2,
      raw: {},
      values: { full_name: "متعاقد واحد", instructor_type_code: "con", max_weekly_hours: 10 },
    };
    expect(prepareInstructorRow(conRow, [], TEMPLATES.instructors.columns)).toEqual([]);
    const permanent = {
      rowNumber: 3,
      raw: {},
      values: { full_name: "موظف واحد", instructor_type_code: "permanent", max_weekly_hours: 18 },
    };
    expect(
      prepareInstructorRow(permanent, [], TEMPLATES.instructors.columns).some(
        (e) => e.errorCode === "instructor_employee_number_required",
      ),
    ).toBe(true);
  });

  test("department head requires a headed department", () => {
    const row = {
      rowNumber: 4,
      raw: {},
      values: {
        full_name: "رئيس قسم",
        employee_number: "E1",
        instructor_type_code: "permanent",
        max_weekly_hours: 18,
        administrative_position: "department_head",
      },
    };
    expect(
      prepareInstructorRow(row, [], TEMPLATES.instructors.columns).some(
        (e) => e.errorCode === "administrative_department_required",
      ),
    ).toBe(true);
  });
});

describe("weekly teaching-hours preflight uses net quota", () => {
  test("base 18 - release 4 rejects a weekly total of 15", () => {
    const mk = (rowNumber: number, dg: string, component: string, hours: number) => ({
      rowNumber,
      raw: {},
      values: {
        _delivery_group_id: dg,
        _component_id: component,
        _instructor_id: "i1",
        _term_id: "t1",
        study_system: "regular",
        component_type: "theory",
        _component_weekly_hours: hours,
        _component_total_hours: hours,
        _assigned_component_hours: hours,
        assigned_component_hours: hours,
        _is_active: true,
        _instructor_max_weekly_hours: 18,
        _instructor_administrative_release_hours: 4,
      },
    });
    const result = preflightCanonicalTeachingHours({
      canonicalOperations: [mk(2, "dg1", "c1", 8), mk(3, "dg2", "c2", 7)],
      existingV2Assignments: [],
    });
    expect(result.errors.some((e) => e.errorCode === "INSTRUCTOR_TEACHING_HOURS_OVER_LIMIT")).toBe(
      true,
    );
  });
});

describe("schema migration contract", () => {
  test("adds affiliation/admin columns, backfill and consistency trigger", () => {
    const sql = source(
      "supabase/migrations/20260914030000_instructor_hr_affiliation_and_effective_quota.sql",
    );
    for (const col of [
      "affiliation_college_id",
      "affiliation_department_id",
      "administrative_position",
      "administrative_department_id",
    ])
      expect(sql).toContain(col);
    expect(sql).toContain("affiliation_college_id = COALESCE(affiliation_college_id, college_id)");
    expect(sql).toContain("trg_instructors_hr_affiliation");
    expect(sql).toContain("ambiguous name match without employee_number");
  });
});
