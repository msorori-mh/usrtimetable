import { readFileSync } from "node:fs";
import {
  buildPlanComponentSyncPayload,
  collectPlanComponentRoomTypeIssues,
  validatePlanComponentRoomTypes,
  type PlanComponentReadinessRow,
  type RoomTypeCatalogEntry,
} from "../../src/lib/academic-delivery/plan-component-room-types.ts";
import { TEMPLATES } from "../../src/lib/excel-import/templates.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const catalog: RoomTypeCatalogEntry[] = [
  {
    id: "lecture",
    code: "lecture_hall",
    college_id: "c1",
    is_active: true,
    default_capacity: 40,
  },
  {
    id: "lab",
    code: "computer_lab",
    college_id: "c1",
    is_active: true,
    default_capacity: 25,
  },
  {
    id: "inactive",
    code: "seminar_room",
    college_id: "c1",
    is_active: false,
    default_capacity: 10,
  },
  {
    id: "zero",
    code: "workshop",
    college_id: "c1",
    is_active: true,
    default_capacity: 0,
  },
  {
    id: "other",
    code: "network_lab",
    college_id: "c2",
    is_active: true,
    default_capacity: 20,
  },
];
const context = {
  rowNumber: 7,
  programCode: "CS",
  courseCode: "CS101",
  courseName: "Intro",
  levelNumber: 1,
  semester: 1,
};
const validate = (
  hours: Parameters<typeof validatePlanComponentRoomTypes>[0]["hours"],
  values: Parameters<typeof validatePlanComponentRoomTypes>[0]["values"],
  cat = catalog,
) => validatePlanComponentRoomTypes({ context, hours, values, collegeId: "c1", catalog: cat });
const code = (result: ReturnType<typeof validate>, expected: string) =>
  assert(
    result.errors.some((item) => item.errorCode === expected),
    `expected ${expected}`,
  );

function row(patch: Partial<PlanComponentReadinessRow>): PlanComponentReadinessRow {
  return {
    college_code: "C1",
    college_id: "c1",
    program_code: "CS",
    study_plan_id: "p1",
    level_number: 1,
    semester: 1,
    course_code: "CS101",
    course_name: "Intro",
    component_type: "theory",
    component_hours: 2,
    is_timetabled: true,
    room_type_id: "lecture",
    room_type_code: "lecture_hall",
    room_type_college_id: "c1",
    room_type_active: true,
    room_type_capacity: 40,
    ...patch,
  };
}

function run() {
  for (const entity of ["study_plan_courses", "full_study_plan"] as const) {
    const headers = TEMPLATES[entity].columns.map((column) => column.header);
    for (const required of [
      "نوع_قاعة_المحاضرة_رمز",
      "نوع_قاعة_العملي_رمز",
      "نوع_قاعة_التمرين_رمز",
      "نوع_قاعة_المشروع_رمز",
      "نوع_قاعة_المحاضرة",
      "نوع_قاعة_المعمل",
    ]) {
      assert(headers.includes(required), `${entity} exports ${required}`);
    }
  }

  code(validate({ theory_hours: 2 }, {}), "ROOM_TYPE_CODE_REQUIRED");
  code(
    validate({ theory_hours: 2 }, { required_room_type_code_lecture: "not_real" }),
    "ROOM_TYPE_CODE_UNKNOWN",
  );
  code(
    validate({ theory_hours: 2 }, { required_room_type_code_lecture: "lecture_hall" }, [
      ...catalog,
      { ...catalog[0], id: "duplicate" },
    ]),
    "ROOM_TYPE_CODE_AMBIGUOUS",
  );
  code(
    validate({ tutorial_hours: 1 }, { required_room_type_code_tutorial: "seminar_room" }),
    "ROOM_TYPE_INACTIVE",
  );
  code(
    validate({ project_hours: 1 }, { required_room_type_code_project: "workshop" }),
    "ROOM_TYPE_ZERO_CAPACITY",
  );
  code(
    validate({ practical_hours: 2 }, { required_room_type_code_practical: "network_lab" }),
    "ROOM_TYPE_WRONG_COLLEGE",
  );
  code(
    validate(
      { theory_hours: 2 },
      {
        required_room_type_code_lecture: "lecture_hall",
        required_room_type_for_lecture: "computer_lab",
      },
    ),
    "ROOM_TYPE_ALIAS_CONFLICT",
  );
  assert(
    validate(
      { theory_hours: 2, practical_hours: 2 },
      {
        required_room_type_for_lecture: " LEC ",
        required_room_type_for_lab: "computer lab",
      },
    ).errors.length === 0,
    "aliases, case and spaces normalize",
  );
  assert(validate({ theory_hours: 0 }, {}).errors.length === 0, "zero hours need no fake type");
  assert(
    validate({ is_summer_training: true, tutorial_hours: 3 }, {}).errors.length === 0,
    "non-timetabled summer training is exempt",
  );
  const ok = validate({ theory_hours: 2 }, { required_room_type_code_lecture: "lecture_hall" });
  const payload = buildPlanComponentSyncPayload({ theory_hours: 2 }, ok.resolvedIds);
  assert(payload[0]?.required_room_type_id === "lecture", "resolved id reaches sync contract");

  assert(collectPlanComponentRoomTypeIssues([row({})]).length === 0, "valid reference ready");
  assert(
    collectPlanComponentRoomTypeIssues([row({ room_type_id: null })])[0]?.issue_code ===
      "NULL_REQUIRED_ROOM_TYPE",
    "readiness null",
  );
  assert(
    collectPlanComponentRoomTypeIssues([row({ room_type_code: null })])[0]?.issue_code ===
      "ORPHAN_ROOM_TYPE",
    "readiness orphan",
  );
  assert(
    collectPlanComponentRoomTypeIssues([row({ room_type_active: false })])[0]?.issue_code ===
      "INACTIVE_ROOM_TYPE",
    "readiness inactive",
  );
  assert(
    collectPlanComponentRoomTypeIssues([row({ room_type_capacity: 0 })])[0]?.issue_code ===
      "ZERO_CAPACITY_ROOM_TYPE",
    "readiness zero capacity",
  );
  assert(
    collectPlanComponentRoomTypeIssues([row({ room_type_college_id: "c2" })])[0]?.issue_code ===
      "WRONG_COLLEGE_ROOM_TYPE",
    "readiness wrong college",
  );
  assert(
    collectPlanComponentRoomTypeIssues([
      row({ is_timetabled: false, room_type_id: null }),
      row({ component_type: "summer_training", room_type_id: null }),
    ]).length === 0,
    "non-active/non-timetabled components ignored",
  );

  const commit = readFileSync("src/lib/excel-import/commit.ts", "utf8");
  assert(
    commit.includes("PLAN_COMPONENT_ROOM_TYPE_PERSISTENCE_RPC_REQUIRED"),
    "commit fails closed",
  );
  const wrapper = readFileSync("src/lib/academic-delivery/generate-delivery-groups.ts", "utf8");
  assert(
    wrapper.indexOf("checkCohortRoomTypeGate") < wrapper.indexOf('"resolve_scheduling_headcount"'),
    "room gate runs before any generator-related RPC",
  );
  const ui = readFileSync("src/routes/_authenticated/academic-cohorts.tsx", "utf8");
  assert(ui.includes("roomTypeIssues.length > 0"), "actual DG button is disabled by blocker");
  assert(ui.includes("توليد مقررات الدفعة"), "curriculum action remains separate");
}

run();
console.log("plan component room type normalization source harness: PASS");
