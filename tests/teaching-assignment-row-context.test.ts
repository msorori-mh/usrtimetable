import { describe, expect, it } from "vitest";
import { assignmentRowAcademicContext } from "@/lib/teaching-assignments/assignment-row-context";

const row = {
  delivery_group_id: "group-anchor",
  cohort_id: "cohort-regular",
  program_id: "program-it",
  study_system: "regular",
};

const cohorts = [
  { id: "cohort-regular", program_id: "program-it", study_system: "regular" },
  { id: "cohort-parallel", program_id: "program-jawf", study_system: "parallel" },
];

const programs = [
  { id: "program-it", name: "تقنية المعلومات" },
  { id: "program-jawf", name: "تقنية المعلومات - الجوف" },
];

describe("assignmentRowAcademicContext", () => {
  it("uses the row cohort rather than the selected filter for a regular group", () => {
    expect(
      assignmentRowAcademicContext({ row, cohorts, programs, sharedLectures: [] }),
    ).toEqual({ programLabel: "تقنية المعلومات", studySystemLabel: "عام" });
  });

  it("shows every participating program and study system for a shared group", () => {
    expect(
      assignmentRowAcademicContext({
        row,
        cohorts,
        programs,
        sharedLectures: [
          {
            anchor_group_id: "group-anchor",
            member_group_id: "group-member",
            cohort_id: "cohort-parallel",
            anchor_cohort_id: "cohort-regular",
            cohort_code: "JOUF-P",
            expected_students: 20,
            total_students: 50,
            course_name: "شبكات",
            study_system: "parallel",
          },
        ],
      }),
    ).toEqual({
      programLabel: "تقنية المعلومات، تقنية المعلومات - الجوف",
      studySystemLabel: "عام، موازي",
    });
  });
});