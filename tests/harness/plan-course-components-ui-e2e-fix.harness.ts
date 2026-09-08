/**
 * SOURCE_ONLY_PLAN_COURSE_COMPONENTS_UI_E2E_FIX_01
 * Static + pure-logic harness: role gating, scoping, validation, derivation,
 * delete ordering, readiness invalidation/link, RTL/mobile affordances.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildComponentInsert,
  buildLevelInsert,
  buildPlanCourseInsert,
  COMPENSATION_MODES,
  deriveComponentInsertsFromCourse,
  PLAN_COMPONENT_TYPES,
  PLAN_COURSE_READINESS_QUERY_KEYS,
  planCourseDeleteSteps,
  validateComponentForm,
  validateLevelForm,
  validatePlanCourseForm,
  type ComponentForm,
  type CourseOption,
  type ExistingPlanCourse,
  type LevelOption,
  type PlanContext,
  type RoomTypeOption,
} from "../../src/lib/academic-delivery/plan-course-editor.ts";
import { fixHrefForMetric } from "../../src/lib/data-onboarding/classify.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const COLLEGE = "college-1";
const OTHER = "college-2";
const ctx: PlanContext = { collegeId: COLLEGE, studyPlanId: "plan-1", programId: "prog-1" };

const courses: CourseOption[] = [
  {
    id: "c1",
    code: "TEST-E2E-C101",
    name: "مقرر",
    college_id: COLLEGE,
    theory_hours: 2,
    practical_hours: 2,
    credit_hours: 3,
  },
  { id: "c-foreign", code: "X", name: "خارج", college_id: OTHER, theory_hours: 3 },
];
const levels: LevelOption[] = [
  { id: "l1", name: "المستوى الأول", level_number: 1, program_id: "prog-1", college_id: COLLEGE },
  {
    id: "l-other-prog",
    name: "آخر",
    level_number: 1,
    program_id: "prog-2",
    college_id: COLLEGE,
  },
  {
    id: "l-other-college",
    name: "آخر",
    level_number: 2,
    program_id: "prog-1",
    college_id: OTHER,
  },
];
const roomTypes: RoomTypeOption[] = [
  { id: "rt1", name_ar: "قاعة", college_id: COLLEGE, is_active: true },
  { id: "rt-foreign", name_ar: "قاعة أخرى", college_id: OTHER, is_active: true },
];

// 1) Happy path
assert(
  validatePlanCourseForm({
    ctx,
    form: { course_id: "c1", level_id: "l1", semester: 1, is_required: true },
    courses,
    levels,
    existing: [],
  }).ok,
  "valid plan course must pass",
);

// 2) College scoping for courses
const foreignCourse = validatePlanCourseForm({
  ctx,
  form: { course_id: "c-foreign", level_id: "l1", semester: 1, is_required: true },
  courses,
  levels,
  existing: [],
});
assert(!foreignCourse.ok && foreignCourse.code === "COURSE_COLLEGE_MISMATCH", "foreign course must fail closed");

// 3) Level program/college scoping
for (const bad of ["l-other-prog", "l-other-college"]) {
  const r = validatePlanCourseForm({
    ctx,
    form: { course_id: "c1", level_id: bad, semester: 1, is_required: true },
    courses,
    levels,
    existing: [],
  });
  assert(!r.ok && r.code === "LEVEL_SCOPE_MISMATCH", `level ${bad} must fail closed`);
}

// 4) Semester validation
for (const s of [0, 3, 1.5]) {
  const r = validatePlanCourseForm({
    ctx,
    form: { course_id: "c1", level_id: "l1", semester: s, is_required: true },
    courses,
    levels,
    existing: [],
  });
  assert(!r.ok && r.code === "SEMESTER_INVALID", `semester ${s} must be rejected`);
}

// 5) Duplicate handling with Arabic message
const existing: (ExistingPlanCourse & { is_required: boolean })[] = [
  {
    id: "pc1",
    course_id: "c1",
    level_id: "l1",
    semester: 1,
    study_plan_id: "plan-1",
    college_id: COLLEGE,
    is_required: true,
  },
];
const dup = validatePlanCourseForm({
  ctx,
  form: { course_id: "c1", level_id: "l1", semester: 1, is_required: true },
  courses,
  levels,
  existing,
});
assert(!dup.ok && dup.code === "PLAN_COURSE_DUPLICATE", "duplicate must be rejected");
assert(!dup.ok && /مضاف مسبقاً/.test(dup.messageAr), "duplicate message must be Arabic");
assert(
  validatePlanCourseForm({
    ctx,
    form: { course_id: "c1", level_id: "l1", semester: 2, is_required: true },
    courses,
    levels,
    existing,
  }).ok,
  "same course in other semester must be allowed",
);
assert(
  validatePlanCourseForm({
    ctx,
    form: { course_id: "c1", level_id: "l1", semester: 1, is_required: false },
    courses,
    levels,
    existing,
    editingId: "pc1",
  }).ok,
  "editing the same row must not self-conflict",
);

// 6) Insert payload derives plan/program/college from context only
const insert = buildPlanCourseInsert(ctx, {
  course_id: "c1",
  level_id: "l1",
  semester: 2,
  is_required: false,
});
assert(insert.college_id === COLLEGE && insert.study_plan_id === "plan-1", "context must own scope");
assert(!("program_id" in insert), "plan_courses insert must not invent columns");
assert(buildLevelInsert(ctx, { name: " م ", level_number: 1 }).program_id === "prog-1", "level insert scoped to plan program");

// 7) Component derivation: theory 2 + practical 2 => exactly theory & practical
const derived = deriveComponentInsertsFromCourse(ctx, "pc1", courses[0]!);
assert(derived.length === 2, `expected 2 derived components, got ${derived.length}`);
assert(
  derived.map((d) => d.component_type).join(",") === "theory,practical",
  "derivation must yield theory then practical only",
);
assert(
  derived.every((d) => d.college_id === COLLEGE && d.plan_course_id === "pc1"),
  "derived rows must carry scope",
);
assert(
  derived.every((d) => d.weekly_contact_hours === 2),
  "derived hours must come from explicit hour columns",
);
// credit_hours must never create components
const creditOnly = deriveComponentInsertsFromCourse(ctx, "pc1", {
  theory_hours: 0,
  practical_hours: 0,
});
assert(creditOnly.length === 0, "credit_hours must never derive components");

// 8) Component field validation
const baseComponent: ComponentForm = {
  component_type: "theory",
  weekly_contact_hours: 2,
  required_room_type_id: "rt1",
  is_timetabled: true,
  counts_toward_regular_load: true,
  counts_toward_overtime: true,
  compensation_mode: "per_hour",
  explicit_group_size: 25,
};
assert(validateComponentForm({ ctx, form: baseComponent, roomTypes }).ok, "valid component passes");
const badRoom = validateComponentForm({
  ctx,
  form: { ...baseComponent, required_room_type_id: "rt-foreign" },
  roomTypes,
});
assert(!badRoom.ok && badRoom.code === "ROOM_TYPE_SCOPE_MISMATCH", "foreign room type fails closed");
const badType = validateComponentForm({
  ctx,
  form: { ...baseComponent, component_type: "lecture" },
  roomTypes,
});
assert(!badType.ok && badType.code === "COMPONENT_TYPE_INVALID", "unknown component type rejected");
const badMode = validateComponentForm({
  ctx,
  form: { ...baseComponent, compensation_mode: "monthly" },
  roomTypes,
});
assert(!badMode.ok && badMode.code === "COMPENSATION_MODE_INVALID", "unknown compensation rejected");
const badHours = validateComponentForm({
  ctx,
  form: { ...baseComponent, weekly_contact_hours: 0 },
  roomTypes,
});
assert(!badHours.ok && badHours.code === "HOURS_REQUIRED_FOR_TIMETABLED", "timetabled needs hours");
const badGroup = validateComponentForm({
  ctx,
  form: { ...baseComponent, explicit_group_size: 0 },
  roomTypes,
});
assert(!badGroup.ok && badGroup.code === "GROUP_SIZE_INVALID", "group size must be positive int");
const payload = buildComponentInsert(ctx, "pc1", baseComponent);
for (const field of [
  "component_type",
  "weekly_contact_hours",
  "required_room_type_id",
  "is_timetabled",
  "counts_toward_regular_load",
  "counts_toward_overtime",
  "compensation_mode",
  "explicit_group_size",
]) {
  assert(field in payload, `component payload missing ${field}`);
}
assert(PLAN_COMPONENT_TYPES.length === 5 && COMPENSATION_MODES.length === 3, "enumerations frozen");

// 9) Level quick-add validation
assert(validateLevelForm({ form: { name: "المستوى الأول", level_number: 1 }, durationYears: 4, existing: [] }).ok, "valid level passes");
const outOfRange = validateLevelForm({
  form: { name: "خامس", level_number: 5 },
  durationYears: 4,
  existing: [],
});
assert(!outOfRange.ok && outOfRange.code === "LEVEL_NUMBER_OUT_OF_RANGE", "level range enforced");
const dupLevel = validateLevelForm({
  form: { name: "الأول", level_number: 1 },
  durationYears: 4,
  existing: [levels[0]!],
});
assert(!dupLevel.ok && dupLevel.code === "LEVEL_DUPLICATE", "duplicate level rejected");
const noDuration = validateLevelForm({
  form: { name: "الأول", level_number: 1 },
  durationYears: 0,
  existing: [],
});
assert(!noDuration.ok && noDuration.code === "PROGRAM_DURATION_UNKNOWN", "unknown duration fails closed");

// 10) Exact delete ordering
const steps = planCourseDeleteSteps({ collegeId: COLLEGE, planCourseId: "pc1", componentIds: ["k1", "k2"] });
assert(steps.length === 2, "expected two delete steps");
assert(steps[0]!.table === "plan_course_components", "components must be deleted first");
assert(steps[1]!.table === "plan_courses", "plan course deleted last");
assert(steps.every((s) => s.collegeId === COLLEGE), "delete steps must be college scoped");
const noComponentSteps = planCourseDeleteSteps({
  collegeId: COLLEGE,
  planCourseId: "pc1",
  componentIds: [],
});
assert(
  noComponentSteps.length === 1 && noComponentSteps[0]!.table === "plan_courses",
  "no component deletes when none exist",
);

// 11) Readiness invalidation + fix link
for (const key of ["data-readiness", "data-onboarding-readiness"]) {
  assert(
    (PLAN_COURSE_READINESS_QUERY_KEYS as readonly string[]).includes(key),
    `readiness key ${key} must be invalidated`,
  );
}
const fix = fixHrefForMetric({
  label: "مقررات غير مرتبطة بأي خطة دراسية",
  total: 1,
  missing: 1,
  category: "study_plan",
});
assert(fix.href === "/study-plans", "blocker must link to /study-plans");
assert(fix.labelAr.includes("مقررات الخطة"), "fix label must point to plan-course management");

// 12) UI source contract: RTL/mobile, role gating, no SQL/bypass
const ui = read("src/components/study-plans/plan-courses-manager.tsx");
assert(ui.includes("إدارة مقررات الخطة"), "manager title required");
assert(ui.includes('data-testid="plan-courses-manager"'), "manager testid required");
assert(ui.includes("canManage &&"), "write controls must be gated by canManage");
assert(!/service_role|supabaseAdmin|\.rpc\(/.test(ui), "no admin client or RPC bypass allowed");
assert(ui.includes("sm:max-w-2xl") && ui.includes("overflow-y-auto"), "mobile-friendly sheet required");
assert(ui.includes("grid-cols-1") && ui.includes("sm:grid-cols-2"), "responsive form grid required");
assert(ui.includes("ms-1"), "RTL-aware logical spacing required");
assert(ui.includes("توليد من ساعات المقرر"), "derive-from-hours action required");
assert(ui.includes('.eq("college_id", collegeId)'), "queries must be college scoped");

const page = read("src/routes/_authenticated/study-plans.tsx");
assert(page.includes("PlanCoursesManager"), "study-plans page must mount the manager");
assert(page.includes("canManage={canManage}"), "manager must receive canManage");
assert(page.includes("duration_years"), "program duration must be loaded for level validation");

const editor = read("src/lib/academic-delivery/plan-course-editor.ts");
assert(!/credit_hours\s*[:=]\s*/.test(editor.split("deriveComponentInsertsFromCourse")[1] ?? ""), "derivation must not use credit_hours");

console.log("PLAN_COURSE_COMPONENTS_UI_E2E_FIX_01 harness: all assertions passed");
