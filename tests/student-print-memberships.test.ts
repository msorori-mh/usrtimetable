import { describe, expect, test } from "bun:test";
import {
  expandStudentPrintMemberships,
  type PrintCohortScope,
} from "../src/lib/print-center/student-memberships";
import { groupCurrentSchedulePages } from "../src/lib/print-center/current-schedule";
import { filterCurrentScheduleScope } from "../src/lib/print-center/current-schedule-scope";

const scopes: PrintCohortScope[] = [
  {
    id: "ai",
    program_id: "ai",
    program_name: "الذكاء الاصطناعي",
    level_id: "l1",
    level_name: "الأول",
    level_number: 1,
    department_id: "d-ai",
    department_name: "الذكاء",
    study_system: "regular",
  },
  {
    id: "is",
    program_id: "is",
    program_name: "نظم المعلومات",
    level_id: "l1",
    level_name: "الأول",
    level_number: 1,
    department_id: "d-is",
    department_name: "النظم",
    study_system: "parallel",
  },
];
const row = {
  id: "arabic",
  day_of_week: 0,
  start_time: "12:00",
  end_time: "14:00",
  cohort_id: "ai",
  delivery_group_id: "g",
  study_system: "regular",
  instructor_id: "teacher",
  room_id: "hall",
  course_offerings: {
    program_id: "ai",
    level_id: "l1",
    courses: { name: "مهارات اللغة العربية (1)" },
  },
};
const members = [
  { delivery_group_id: "g", cohort_id: "ai" },
  { delivery_group_id: "g", cohort_id: "is" },
  { delivery_group_id: "g", cohort_id: "is" },
];
describe("merged student timetable print membership", () => {
  test("includes every participant exactly once, despite multiple student partitions", () => {
    const input = structuredClone(row);
    const rows = expandStudentPrintMemberships([input], members, scopes);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(rows.map((r) => r.cohort_id)).toEqual(["ai", "is"]);
    for (const r of rows)
      expect([r.start_time, r.end_time, r.room_id, r.instructor_id]).toEqual([
        "12:00",
        "14:00",
        "hall",
        "teacher",
      ]);
    expect(input).toEqual(row);
  });
  test("program and department pages contain the shared course after filtering", () => {
    const rows = expandStudentPrintMemberships([row], members, scopes);
    for (const c of scopes) {
      const selected = filterCurrentScheduleScope(
        rows,
        scopes.map((s) => ({ id: s.program_id, department_id: s.department_id })),
        c.department_id,
        c.program_id,
      );
      const pages = groupCurrentSchedulePages(selected, {
        collegeId: "college",
        studySystem: "all",
      });
      expect(pages).toHaveLength(1);
      expect(pages[0].programName).toBe(c.program_name);
      expect(pages[0].studySystem).toBe(c.study_system);
      expect(pages[0].sessions[0].course_offerings?.courses?.name).toBe("مهارات اللغة العربية (1)");
    }
  });
  test("study-system filtering sees the member's system, not the anchor's", () => {
    const rows = expandStudentPrintMemberships([row], members, scopes).filter(
      (r) => r.study_system === "parallel",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].cohort_id).toBe("is");
  });
  test("unmerged and legacy rows survive; replaced split parents do not print", () => {
    expect(expandStudentPrintMemberships([row], [], [])).toEqual([row]);
    expect(
      expandStudentPrintMemberships([{ ...row, replaced_by_split: true }], members, scopes),
    ).toEqual([]);
  });
  test("missing participant metadata fails rather than silently dropping a program", () => {
    expect(() => expandStudentPrintMemberships([row], members, scopes.slice(0, 1))).toThrow();
  });
  test("existing imported membership paths remain distinct without duplicate physical/cohort rows", () => {
    const imported = {
      ...row,
      intake_memberships: scopes.map((c) => ({
        source_id: c.id,
        cohort_id: c.id,
        delivery_group_id: "g",
        study_plan_id: `plan-${c.id}`,
        program_id: c.program_id,
        program_name: c.program_name,
        level_id: c.level_id,
        level_name: c.level_name,
        department_id: c.department_id,
        department_name: c.department_name,
      })),
    };
    expect(expandStudentPrintMemberships([imported], members, scopes)).toHaveLength(2);
    const withoutPartitions = expandStudentPrintMemberships([imported], [], scopes);
    expect(withoutPartitions.map((r) => r.cohort_id)).toEqual(["ai", "is"]);
    expect(new Set(withoutPartitions.map((r) => r.id)).size).toBe(2);
    expect(withoutPartitions.map((r) => r.study_system)).toEqual(["regular", "parallel"]);
  });
});
