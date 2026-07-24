/**
 * PLAN-COMPONENT-ROOM-TYPE-PERMANENT-FIX-01 — import validation, sync payload, DG gate.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TEMPLATES } from "../../src/lib/excel-import/templates.ts";
import {
  buildPlanComponentSyncPayload,
  collectMissingRoomTypeComponents,
  requiresRoomTypeForComponent,
  validatePlanRowRoomTypes,
  type RoomTypeCatalogEntry,
} from "../../src/lib/academic-delivery/plan-component-room-types.ts";
import { derivePlanCourseComponents } from "../../src/lib/academic-delivery/plan-course-components.ts";
import { calculateDeliveryGroupCount } from "../../src/lib/academic-delivery/delivery-groups.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const COLLEGE = "college-a";
const OTHER_COLLEGE = "college-b";

const catalog: RoomTypeCatalogEntry[] = [
  {
    id: "rt-lecture",
    code: "lecture_hall",
    college_id: COLLEGE,
    is_active: true,
    default_capacity: 60,
  },
  {
    id: "rt-lab",
    code: "computer_lab",
    college_id: COLLEGE,
    is_active: true,
    default_capacity: 30,
  },
  {
    id: "rt-inactive",
    code: "seminar_room",
    college_id: COLLEGE,
    is_active: false,
    default_capacity: 25,
  },
  {
    id: "rt-zero",
    code: "workshop",
    college_id: COLLEGE,
    is_active: true,
    default_capacity: 0,
  },
  {
    id: "rt-other",
    code: "network_lab",
    college_id: OTHER_COLLEGE,
    is_active: true,
    default_capacity: 20,
  },
];

function run() {
  const tpl = TEMPLATES.study_plan_courses;
  assert(
    tpl.columns.some((c) => c.key === "required_room_type_code_lecture"),
    "template has required_room_type_code_lecture",
  );
  assert(
    tpl.columns.some((c) => c.key === "required_room_type_code_practical"),
    "template has required_room_type_code_practical",
  );
  assert(
    tpl.columns.some((c) => c.key === "required_room_type_code_tutorial"),
    "template has required_room_type_code_tutorial",
  );
  assert(
    tpl.columns.some((c) => c.key === "required_room_type_code_project"),
    "template has required_room_type_code_project",
  );
  assert(
    tpl.columns.some((c) => c.header === "نوع_قاعة_المحاضرة"),
    "legacy lecture alias header retained",
  );
  assert(
    tpl.columns.some((c) => c.header === "نوع_قاعة_المعمل"),
    "legacy lab alias header retained",
  );

  const validatorsSrc = readFileSync(join(root, "src/lib/excel-import/validators.ts"), "utf8");
  assert(
    validatorsSrc.includes("validatePlanRowRoomTypes"),
    "validators call validatePlanRowRoomTypes",
  );
  assert(validatorsSrc.includes("buildPlanComponentSyncPayload"), "validators build sync payload");
  assert(validatorsSrc.includes("_plan_component_sync"), "validators attach _plan_component_sync");

  const genSrc = readFileSync(
    join(root, "src/lib/academic-delivery/generate-delivery-groups.ts"),
    "utf8",
  );
  assert(genSrc.includes("checkCohortDeliveryGroupRoomTypes"), "generator pre-check gate");

  const cohortsSrc = readFileSync(
    join(root, "src/routes/_authenticated/academic-cohorts.tsx"),
    "utf8",
  );
  assert(cohortsSrc.includes("cohort-room-type-blocker"), "cohorts UI blocker panel");
  assert(
    cohortsSrc.includes("roomTypeBlocker.length > 0"),
    "cohorts disable DG button when blocker",
  );
  assert(
    !cohortsSrc.includes("generateCurriculum.isPending || roomTypeBlocker"),
    "cohort curriculum button not blocked by room types",
  );

  // theory + lecture_hall
  const theoryOk = validatePlanRowRoomTypes({
    courseCode: "CS101",
    hours: { theory_hours: 2, practical_hours: 0 },
    roomTypeCodes: { required_room_type_code_lecture: "lecture_hall" },
    collegeId: COLLEGE,
    catalog,
  });
  assert(theoryOk.errors.length === 0, "theory + lecture_hall accepted");
  assert(theoryOk.resolvedIds.theory === "rt-lecture", "theory resolves rt id");

  // practical + computer_lab
  const practicalOk = validatePlanRowRoomTypes({
    courseCode: "CS102",
    hours: { practical_hours: 2 },
    roomTypeCodes: { required_room_type_code_practical: "computer_lab" },
    collegeId: COLLEGE,
    catalog,
  });
  assert(practicalOk.errors.length === 0, "practical + computer_lab accepted");

  // tutorial + lecture_hall
  const tutorialOk = validatePlanRowRoomTypes({
    courseCode: "CS103",
    hours: { tutorial_hours: 1 },
    roomTypeCodes: { required_room_type_code_tutorial: "lecture_hall" },
    collegeId: COLLEGE,
    catalog,
  });
  assert(tutorialOk.errors.length === 0, "tutorial + lecture_hall accepted");

  // missing code rejected
  const missing = validatePlanRowRoomTypes({
    courseCode: "CS201",
    hours: { theory_hours: 2 },
    roomTypeCodes: {},
    collegeId: COLLEGE,
    catalog,
  });
  assert(missing.errors.length === 1, "missing code single error");
  assert(missing.errors[0]?.errorCode === "missing_room_type_code", "missing code error code");
  assert(missing.errors[0]?.message.includes("CS201"), "missing includes course code");
  assert(missing.errors[0]?.message.includes("theory"), "missing includes component_type");

  // inactive room type rejected
  const inactive = validatePlanRowRoomTypes({
    courseCode: "CS202",
    hours: { theory_hours: 2 },
    roomTypeCodes: { required_room_type_code_lecture: "seminar_room" },
    collegeId: COLLEGE,
    catalog,
  });
  assert(
    inactive.errors.some((e) => e.errorCode === "inactive_room_type"),
    "inactive rejected",
  );

  // zero capacity rejected
  const zeroCap = validatePlanRowRoomTypes({
    courseCode: "CS203",
    hours: { practical_hours: 2 },
    roomTypeCodes: { required_room_type_code_practical: "workshop" },
    collegeId: COLLEGE,
    catalog,
  });
  assert(
    zeroCap.errors.some((e) => e.errorCode === "zero_capacity_room_type"),
    "zero cap rejected",
  );

  // cross-college rejected
  const cross = validatePlanRowRoomTypes({
    courseCode: "CS204",
    hours: { practical_hours: 2 },
    roomTypeCodes: { required_room_type_code_practical: "network_lab" },
    collegeId: COLLEGE,
    catalog,
  });
  assert(
    cross.errors.some((e) => e.errorCode === "cross_college_room_type"),
    "cross college rejected",
  );

  // project 0 hours — no room type required
  const projectZero = validatePlanRowRoomTypes({
    courseCode: "CS301",
    hours: { is_graduation_project: true, project_hours: 0 },
    roomTypeCodes: {},
    collegeId: COLLEGE,
    catalog,
  });
  assert(projectZero.errors.length === 0, "project 0h no room type");
  const projectComp = derivePlanCourseComponents({
    is_graduation_project: true,
    project_hours: 0,
  });
  assert(
    projectComp.some((c) => c.component_type === "project" && !requiresRoomTypeForComponent(c)),
    "project 0h not requiring room type",
  );

  // summer_training — no delivery group
  const summerDg = calculateDeliveryGroupCount({
    componentType: "summer_training",
    studentCount: 40,
    roomTypeCapacity: { defaultCapacity: 60 },
  });
  assert(
    summerDg.ok && "skipped" in summerDg && summerDg.skipped === true,
    "summer_training skipped",
  );

  // batch errors — all components reported
  const batch = validatePlanRowRoomTypes({
    courseCode: "CS401",
    hours: { theory_hours: 2, practical_hours: 2, tutorial_hours: 1 },
    roomTypeCodes: {},
    collegeId: COLLEGE,
    catalog,
  });
  assert(batch.errors.length === 3, "batch collects all 3 missing components");

  // sync payload writes required_room_type_id
  const sync = buildPlanComponentSyncPayload({
    hours: { theory_hours: 2, practical_hours: 2 },
    resolvedRoomTypeIds: { theory: "rt-lecture", practical: "rt-lab" },
  });
  const theoryRow = sync.find((r) => r.component_type === "theory");
  const practicalRow = sync.find((r) => r.component_type === "practical");
  assert(theoryRow?.required_room_type_id === "rt-lecture", "sync theory room type id");
  assert(practicalRow?.required_room_type_id === "rt-lab", "sync practical room type id");

  // cohort gate batch
  const gate = collectMissingRoomTypeComponents(
    [
      {
        componentId: "c1",
        componentType: "theory",
        weeklyContactHours: 2,
        isTimetabled: true,
        requiredRoomTypeId: null,
        courseCode: "X1",
        courseName: "Course",
        programName: "CS",
        levelName: "L1",
        semester: 1,
      },
      {
        componentId: "c2",
        componentType: "practical",
        weeklyContactHours: 2,
        isTimetabled: true,
        requiredRoomTypeId: "rt-lab",
        courseCode: "X2",
        courseName: "Course2",
        programName: "CS",
        levelName: "L1",
        semester: 1,
        roomDefaultCapacity: 30,
        roomTypeActive: true,
        roomTypeCollegeId: COLLEGE,
      },
    ],
    { collegeId: COLLEGE, termLabel: "Term 1" },
  );
  assert(!gate.ok && gate.code === "MISSING_ROOM_TYPE_COMPONENTS", "gate fails");
  assert(gate.components.length === 1, "gate lists only missing component");

  console.log("plan-component-room-type-permanent-fix.harness.ts: all assertions passed");
}

run();
