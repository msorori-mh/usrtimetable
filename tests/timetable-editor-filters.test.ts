import { describe, expect, test } from "bun:test";
import {
  buildTimetableLevelOptions,
  filterUnscheduledNewFlowWorkItems,
  isLegacyCourseOffering,
  preserveTimetableLevelFilter,
} from "../src/lib/schedule-builder/timetable-editor-filters";

describe("timetable editor filters", () => {
  const programs = [
    { id: "p1", name: "CS", department_id: "d1" },
    { id: "p2", name: "IT", department_id: "d1" },
  ];
  const levels = [
    { id: "a", name: "المستوى 1", program_id: "p1", level_number: 1 },
    { id: "b", name: "المستوى 2", program_id: "p1", level_number: 2 },
    { id: "c", name: "المستوى 2", program_id: "p2", level_number: 2 },
    { id: "d", name: "المستوى 3", program_id: "p1", level_number: 3 },
    { id: "e", name: "المستوى 3", program_id: "p2", level_number: 3 },
    { id: "f", name: "المستوى 4", program_id: "p2", level_number: 4 },
  ];

  test("dedupes and sorts levels by level_number", () => {
    const opts = buildTimetableLevelOptions({ levels, programs });
    expect(opts.map((o) => o.label)).toEqual(["المستوى 1", "المستوى 2", "المستوى 3", "المستوى 4"]);
    expect(preserveTimetableLevelFilter("2", opts)).toBe("2");
  });

  test("complete New Flow version yields zero unscheduled", () => {
    const rows = [
      {
        teaching_assignment_id: "ta1",
        delivery_group_id: "dg1",
        cohort_id: "c1",
        cohort_code: null,
        program_id: "p1",
        level_id: "a",
        semester_term_id: null,
        study_system: "regular",
        course_id: "c",
        course_code: "CS101",
        course_name: "Intro",
        component_id: "comp",
        component_type: "theory",
        group_number: 1,
        group_code: "G1",
        instructor_id: "i1",
        instructor_name: "A",
        assigned_component_hours: 3,
        component_hours: 3,
        time_unit: "hour",
        currently_scheduled_hours: 3,
        remaining_schedule_hours: 0,
        session_count: 1,
        scheduling_status: "scheduled" as const,
        blocking_reason: null,
        can_create_session: false,
        is_project: false,
        is_summer_training: false,
        assignment_active: true,
        delivery_group_active: true,
        delivery_group_obsolete: false,
        allocation_status: "ok",
        course_offering_id: "off1",
        plan_course_component_id: "pcc",
        session_type: "lecture",
        expected_students: 20,
        assignment_updated_at: null,
      },
    ];
    const items = filterUnscheduledNewFlowWorkItems({
      rows,
      programs,
      levels,
      departments: [{ id: "d1", name: "IT" }],
      filters: {},
    });
    expect(items).toHaveLength(0);
    expect(isLegacyCourseOffering({ plan_course_id: null })).toBe(true);
  });

  test("hides inactive or obsolete work items but keeps active unscheduled work", () => {
    const activeRow = {
      teaching_assignment_id: "active-ta",
      delivery_group_id: "active-dg",
      cohort_id: "c1",
      cohort_code: null,
      program_id: "p1",
      level_id: "a",
      semester_term_id: null,
      study_system: "regular",
      course_id: "c",
      course_code: "CS102",
      course_name: "Active course",
      component_id: "comp",
      component_type: "theory",
      group_number: 1,
      group_code: "G1",
      instructor_id: "i1",
      instructor_name: "A",
      assigned_component_hours: 3,
      component_hours: 3,
      time_unit: "hour",
      currently_scheduled_hours: 0,
      remaining_schedule_hours: 3,
      session_count: 0,
      scheduling_status: "unscheduled" as const,
      blocking_reason: null,
      can_create_session: true,
      is_project: false,
      is_summer_training: false,
      assignment_active: true,
      delivery_group_active: true,
      delivery_group_obsolete: false,
      allocation_status: "ok",
      course_offering_id: "off2",
      plan_course_component_id: "pcc2",
      session_type: "lecture",
      expected_students: 20,
      assignment_updated_at: null,
    };
    const rows = [
      activeRow,
      {
        ...activeRow,
        teaching_assignment_id: "inactive-ta",
        assignment_active: false,
        scheduling_status: "blocked" as const,
        blocking_reason: "INACTIVE_ASSIGNMENT",
        can_create_session: false,
      },
      {
        ...activeRow,
        teaching_assignment_id: "inactive-group-ta",
        delivery_group_id: "inactive-dg",
        delivery_group_active: false,
        scheduling_status: "blocked" as const,
        blocking_reason: "INACTIVE_DELIVERY_GROUP",
        can_create_session: false,
      },
      {
        ...activeRow,
        teaching_assignment_id: "obsolete-group-ta",
        delivery_group_id: "obsolete-dg",
        delivery_group_obsolete: true,
        scheduling_status: "blocked" as const,
        blocking_reason: "OBSOLETE_DELIVERY_GROUP",
        can_create_session: false,
      },
    ];

    const items = filterUnscheduledNewFlowWorkItems({
      rows,
      programs,
      levels,
      departments: [{ id: "d1", name: "IT" }],
      filters: {},
    });

    expect(items.map((item) => item.teaching_assignment_id)).toEqual(["active-ta"]);
  });

});
