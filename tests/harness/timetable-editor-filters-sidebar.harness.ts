/**
 * Timetable editor level filter + New Flow unscheduled sidebar helpers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ScheduleBuilderV2WorkItem } from "../../src/lib/schedule-builder/v2-assignment-integration.ts";
import {
  UNSPECIFIED_DEPARTMENT_AR,
  buildTimetableLevelOptions,
  filterUnscheduledNewFlowWorkItems,
  groupTimetableSidebarItems,
  isLegacyCourseOffering,
  isNewFlowWorkItemUnscheduled,
  preserveTimetableLevelFilter,
  resolveDepartmentLabel,
  sessionMatchesTimetableLevelFilter,
} from "../../src/lib/schedule-builder/timetable-editor-filters.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const programs = [
  { id: "p-cs", name: "CS", department_id: "d1" },
  { id: "p-it", name: "IT", department_id: "d1" },
  { id: "p-bus", name: "BUS", department_id: "d2" },
];

const levels = [
  { id: "l-cs-1", name: "المستوى 1", program_id: "p-cs", level_number: 1 },
  { id: "l-cs-2", name: "المستوى 2", program_id: "p-cs", level_number: 2 },
  { id: "l-cs-3", name: "المستوى 3", program_id: "p-cs", level_number: 3 },
  { id: "l-cs-4", name: "المستوى 4", program_id: "p-cs", level_number: 4 },
  { id: "l-it-1", name: "المستوى 1", program_id: "p-it", level_number: 1 },
  { id: "l-it-2", name: "المستوى 2", program_id: "p-it", level_number: 2 },
  { id: "l-it-3", name: "المستوى 3", program_id: "p-it", level_number: 3 },
  { id: "l-it-4", name: "المستوى 4", program_id: "p-it", level_number: 4 },
  { id: "l-bus-2", name: "المستوى 2", program_id: "p-bus", level_number: 2 },
];

const depts = [
  { id: "d1", name: "تقنية المعلومات" },
  { id: "d2", name: "إدارة الأعمال" },
];

// --- Level options unique + sorted 1→4 (no batch/study-system duplicates) ---
const allOpts = buildTimetableLevelOptions({ levels, programs });
assert(
  allOpts.map((o) => o.label).join("|") === "المستوى 1|المستوى 2|المستوى 3|المستوى 4",
  "labels 1→4",
);
assert(allOpts.map((o) => o.value).join(",") === "1,2,3,4", "values by level_number");
assert(new Set(allOpts.map((o) => o.value)).size === allOpts.length, "unique values");
assert(
  allOpts.every((o, i) => i === 0 || o.levelNumber > allOpts[i - 1].levelNumber),
  "sorted asc",
);

// Fake "cohort/batch" duplication of same level_number+name across programs already covered above.
const withDupRows = buildTimetableLevelOptions({
  levels: [...levels, { id: "l-cs-2b", name: "المستوى 2", program_id: "p-cs", level_number: 2 }],
  programs,
});
assert(
  withDupRows.filter((o) => o.levelNumber === 2).length === 1,
  "no duplicate level_number rows",
);

const byProg = buildTimetableLevelOptions({
  levels,
  programs,
  programId: "p-bus",
});
assert(byProg.map((o) => o.value).join(",") === "2", "program rebuild");

const byDept = buildTimetableLevelOptions({
  levels,
  programs,
  departmentId: "d2",
});
assert(byDept.map((o) => o.value).join(",") === "2", "department rebuild");

const byDeptAll = buildTimetableLevelOptions({
  levels,
  programs,
  departmentId: "d1",
});
assert(byDeptAll.map((o) => o.value).join(",") === "1,2,3,4", "dept d1 has 1-4 unique");

assert(preserveTimetableLevelFilter("3", allOpts) === "3", "preserve available level");
assert(preserveTimetableLevelFilter("9", allOpts) === "all", "reset missing level");
assert(preserveTimetableLevelFilter("2", byProg) === "2", "preserve when still in program");
assert(preserveTimetableLevelFilter("1", byProg) === "all", "reset when program drops level");

assert(
  sessionMatchesTimetableLevelFilter({
    filterValue: "2",
    levelId: "l-it-2",
    levels,
  }),
  "session matches level_number via academic_level_id",
);
assert(
  !sessionMatchesTimetableLevelFilter({
    filterValue: "2",
    levelId: "l-cs-1",
    levels,
  }),
  "session rejects other level_number",
);

// --- Unscheduled New Flow only ---
function wi(
  partial: Partial<ScheduleBuilderV2WorkItem> & { teaching_assignment_id: string },
): ScheduleBuilderV2WorkItem {
  return {
    teaching_assignment_id: partial.teaching_assignment_id,
    delivery_group_id: partial.delivery_group_id ?? "dg1",
    cohort_id: partial.cohort_id ?? "c1",
    cohort_code: null,
    program_id: partial.program_id ?? "p-cs",
    level_id: partial.level_id ?? "l-cs-1",
    semester_term_id: null,
    study_system: partial.study_system ?? "regular",
    course_id: "course1",
    course_code: partial.course_code ?? "CS101",
    course_name: partial.course_name ?? "Intro",
    component_id: "comp1",
    component_type: "theory",
    group_number: 1,
    group_code: "G1",
    instructor_id: partial.instructor_id ?? "i1",
    instructor_name: partial.instructor_name ?? "A",
    assigned_component_hours: 3,
    component_hours: 3,
    time_unit: "hour",
    currently_scheduled_hours: partial.currently_scheduled_hours ?? 0,
    remaining_schedule_hours: partial.remaining_schedule_hours ?? 3,
    session_count: partial.session_count ?? 0,
    scheduling_status: partial.scheduling_status ?? "unscheduled",
    blocking_reason: null,
    can_create_session: true,
    is_project: false,
    is_summer_training: false,
    assignment_active: true,
    delivery_group_active: true,
    delivery_group_obsolete: false,
    allocation_status: "ok",
    course_offering_id: partial.course_offering_id ?? "off1",
    plan_course_component_id: "pcc1",
    session_type: "lecture",
    expected_students: 30,
    assignment_updated_at: null,
  };
}

const completeVersionRows = [
  wi({
    teaching_assignment_id: "ta1",
    scheduling_status: "scheduled",
    remaining_schedule_hours: 0,
    currently_scheduled_hours: 3,
  }),
  wi({
    teaching_assignment_id: "ta2",
    delivery_group_id: "dg2",
    scheduling_status: "scheduled",
    remaining_schedule_hours: 0,
    currently_scheduled_hours: 3,
    course_offering_id: "off2",
  }),
];
const completeUnscheduled = filterUnscheduledNewFlowWorkItems({
  rows: completeVersionRows,
  programs,
  levels,
  departments: depts,
  filters: {},
});
assert(completeUnscheduled.length === 0, "complete version unscheduled count is 0 not 340");

const mixed = filterUnscheduledNewFlowWorkItems({
  rows: [
    ...completeVersionRows,
    wi({
      teaching_assignment_id: "ta3",
      delivery_group_id: "dg3",
      scheduling_status: "unscheduled",
      remaining_schedule_hours: 2,
      course_offering_id: "off3",
      program_id: "p-it",
      level_id: "l-it-2",
      study_system: "parallel",
    }),
  ],
  programs,
  levels,
  departments: depts,
  filters: { levelValue: "2", studySystem: "parallel" },
});
assert(mixed.length === 1, "active filters apply to unscheduled");
assert(mixed[0].is_legacy === false, "sidebar items marked New Flow");

assert(
  isNewFlowWorkItemUnscheduled({ scheduling_status: "scheduled", remaining_schedule_hours: 0 }) ===
    false,
);
assert(isLegacyCourseOffering({ plan_course_id: null }) === true, "legacy offering detected");
assert(isLegacyCourseOffering({ plan_course_id: "pc1" }) === false, "new flow offering");

// Legacy must not enter counter — simulate by ensuring only work-item rows are counted
// (offerings without plan_course_id are never passed into filterUnscheduledNewFlowWorkItems).
assert(
  !read("src/routes/_authenticated/timetable.$versionId.tsx").includes("scheduledOfferingIds"),
  "page no longer uses offering-minus-sessions unscheduled counter",
);

const logs: string[] = [];
const missingDept = resolveDepartmentLabel({
  departmentId: null,
  departments: depts,
  log: (m) => logs.push(m),
});
assert(missingDept === UNSPECIFIED_DEPARTMENT_AR, "missing dept fallback");
assert(logs.includes("timetable_sidebar_missing_department_id"), "logs missing dept reason");

const dashDept = resolveDepartmentLabel({
  departmentId: "d-x",
  departments: [{ id: "d-x", name: "—" }],
  log: (m) => logs.push(m),
});
assert(dashDept === UNSPECIFIED_DEPARTMENT_AR, "dash name fallback");

const grouped = groupTimetableSidebarItems([
  {
    key: "k1",
    teaching_assignment_id: "ta",
    course_offering_id: "off",
    program_id: null,
    level_id: null,
    level_number: null,
    study_system: "regular",
    instructor_id: "i",
    instructor_name: "A",
    course_code: "X",
    course_name: "Y",
    expected_students: 1,
    department_id: null,
    department_label: "—",
    program_label: "P",
    level_label: "المستوى 1",
    is_legacy: false,
  },
]);
assert([...grouped.keys()][0] === UNSPECIFIED_DEPARTMENT_AR, "no dash department heading");
assert(![...grouped.keys()].includes("-") && ![...grouped.keys()].includes("—"), "no dash keys");

// Source wiring guards
const page = read("src/routes/_authenticated/timetable.$versionId.tsx");
assert(page.includes("buildTimetableLevelOptions"), "page uses level options builder");
assert(page.includes("listScheduleBuilderV2WorkItems"), "page loads New Flow work items");
assert(page.includes("filterUnscheduledNewFlowWorkItems"), "page filters New Flow unscheduled");
assert(page.includes("level_number"), "levels query includes level_number");
assert(page.includes("preserveTimetableLevelFilter"), "preserves level filter on rebuild");

console.log("timetable-editor-filters-sidebar.harness.ts: PASS");
