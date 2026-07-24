import { readFileSync } from "node:fs";
import {
  buildPlanComponentSyncPayload,
  collectPlanComponentRoomTypeIssues,
  validatePlanRowRoomTypes,
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
const validate = (
  hours: Parameters<typeof validatePlanRowRoomTypes>[0]["hours"],
  values: Parameters<typeof validatePlanRowRoomTypes>[0]["roomTypeCodes"],
  cat = catalog,
) =>
  validatePlanRowRoomTypes({
    courseCode: "CS101",
    hours,
    roomTypeCodes: values,
    collegeId: "c1",
    catalog: cat,
  });
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
      "رمز_نوع_قاعة_المحاضرة",
      "رمز_نوع_قاعة_المعمل",
      "رمز_نوع_قاعة_التمرين",
      "رمز_نوع_قاعة_المشروع",
      "نوع_قاعة_المحاضرة",
      "نوع_قاعة_المعمل",
    ]) {
      assert(headers.includes(required), `${entity} exports ${required}`);
    }
  }

  code(validate({ theory_hours: 2 }, {}), "missing_room_type_code");
  code(
    validate({ theory_hours: 2 }, { required_room_type_code_lecture: "not_real" }),
    "unknown_room_type_code",
  );
  code(
    validate({ tutorial_hours: 1 }, { required_room_type_code_tutorial: "seminar_room" }),
    "inactive_room_type",
  );
  code(
    validate({ project_hours: 1 }, { required_room_type_code_project: "workshop" }),
    "zero_capacity_room_type",
  );
  code(
    validate({ practical_hours: 2 }, { required_room_type_code_practical: "network_lab" }),
    "cross_college_room_type",
  );
  assert(
    validate(
      { theory_hours: 2, practical_hours: 2 },
      {
        required_room_type_code_lecture: " LEC ",
        required_room_type_code_practical: "computer lab",
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
  const payload = buildPlanComponentSyncPayload({
    hours: { theory_hours: 2 },
    resolvedRoomTypeIds: ok.resolvedIds,
  });
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
    commit.includes("commit_plan_component_import_job_atomic_v2") &&
      commit.includes("ATOMIC_PLAN_COMPONENT_PERSISTENCE_RPC_UNAVAILABLE"),
    "plan commit uses the atomic V2 RPC and fails closed when unavailable",
  );
  const wrapper = readFileSync("src/lib/academic-delivery/generate-delivery-groups.ts", "utf8");
  assert(
    wrapper.indexOf("checkCohortDeliveryGroupRoomTypes(cohortId)") <
      wrapper.indexOf('rpc("generate_cohort_delivery_groups"'),
    "room gate runs before the delivery-group write RPC",
  );
  const ui = readFileSync("src/routes/_authenticated/academic-cohorts.tsx", "utf8");
  assert(ui.includes("roomTypeBlocker.length > 0"), "actual DG button is disabled by blocker");
  assert(ui.includes("توليد مقررات الدفعة"), "curriculum action remains separate");
}

run();
console.log("plan component room type normalization source harness: PASS");
