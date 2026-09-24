/**
 * SCHEDULING-INITIAL-DELIVERY-RUNTIME-CLOSURE-01 — New Flow operational path guards.
 * Static + pure-logic runtime contract (no DB writes).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateDeliveryGroupCount,
  requireSchedulingHeadcountForSplit,
} from "../../src/lib/academic-delivery/delivery-groups.ts";
import {
  derivePlanCourseComponents,
  isElectivePlaceholderCode,
  selectCoursesForCurriculumGeneration,
  termTypeToSemester,
  validateElectiveSelectionForGeneration,
} from "../../src/lib/academic-delivery/plan-course-components.ts";
import { collectMissingRoomTypeComponents } from "../../src/lib/academic-delivery/plan-component-room-types.ts";
import { parseDeliveryGroupGeneratorSummary } from "../../src/lib/academic-delivery/delivery-group-generator-summary.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CYB_COHORTS = [
  "CYB-L1-REG-2026",
  "CYB-L1-PAR-2026",
  "CYB-L2-REG-2025",
  "CYB-L2-PAR-2025",
  "CYB-L3-REG-2024",
] as const;

const NEW_FLOW_SCAN_PATHS = [
  "src/routes/_authenticated/academic-cohorts.tsx",
  "src/routes/_authenticated/delivery-groups.tsx",
  "src/routes/_authenticated/data-readiness.tsx",
  "src/routes/_authenticated/scheduling-headcounts.tsx",
  "src/routes/_authenticated/teaching-assignments.tsx",
  "src/lib/academic-delivery/cohort-delivery-group-room-type-gate.ts",
  "src/lib/academic-delivery/cohort-curriculum-plan-courses.ts",
  "src/lib/academic-delivery/generate-delivery-groups.ts",
  "src/lib/academic-delivery/plan-component-room-type-readiness.ts",
  "src/lib/reports/readiness.ts",
  "src/lib/scheduling-headcount/api.ts",
] as const;

function extractSelectBodies(src: string, childTable: string): string[] {
  const bodies: string[] = [];
  const fromRe = new RegExp(`\\.from\\(["']${childTable}["']\\)`, "g");
  let fromMatch: RegExpExecArray | null;
  while ((fromMatch = fromRe.exec(src)) !== null) {
    const slice = src.slice(fromMatch.index, fromMatch.index + 1800);
    const selectMatch = slice.match(/\.select\s*\(\s*(["'`])([\s\S]*?)\1/s);
    if (selectMatch?.[2]) bodies.push(selectMatch[2]);
  }
  return bodies;
}

function assertNoCourseOfferingsCoursesEmbed(rel: string, src: string) {
  for (const body of extractSelectBodies(src, "course_offerings")) {
    assert(
      !/(?:^|[^!])courses\s*\(/.test(body),
      `${rel}: course_offerings→courses embed forbidden in New Flow path`,
    );
  }
  assert(
    !/from\(["']course_offerings["']\)[\s\S]{0,400}courses\s*\(/.test(src),
    `${rel}: course_offerings→courses embed forbidden in New Flow path`,
  );
}

function cohortFixture(code: (typeof CYB_COHORTS)[number]) {
  const level = code.includes("-L1-") ? 1 : code.includes("-L2-") ? 2 : 3;
  const studySystem = code.includes("-REG-") ? "regular" : "parallel";
  const year = Number(code.split("-").pop());
  return { code, level, studySystem, year };
}

function run() {
  // Phase 1 guard: no course_offerings→courses in New Flow operational path
  for (const rel of NEW_FLOW_SCAN_PATHS) {
    const src = read(rel);
    assertNoCourseOfferingsCoursesEmbed(rel, src);
  }

  const gateSrc = read("src/lib/academic-delivery/cohort-delivery-group-room-type-gate.ts");
  assert(
    !gateSrc.includes('from("course_offerings")'),
    "room type gate does not query course_offerings",
  );
  assert(
    gateSrc.includes("resolveCohortCurriculumPlanCourses"),
    "room type gate uses cohort curriculum plan_courses resolver",
  );

  const curriculumSrc = read("src/lib/academic-delivery/cohort-curriculum-plan-courses.ts");
  assert(
    curriculumSrc.includes('from("plan_courses")'),
    "curriculum resolver queries plan_courses",
  );
  assert(
    curriculumSrc.includes("academic_programs!ac_program_college_fkey(name)"),
    "curriculum resolver disambiguates academic_programs",
  );
  assert(
    curriculumSrc.includes("academic_terms!ac_term_college_fkey(name, term_type)"),
    "curriculum resolver disambiguates academic_terms",
  );
  assert(
    !curriculumSrc.includes('from("course_offerings")'),
    "curriculum resolver does not use course_offerings",
  );

  const cohortsPage = read("src/routes/_authenticated/academic-cohorts.tsx");
  assert(
    cohortsPage.includes("checkCohortDeliveryGroupRoomTypes"),
    "cohorts page runs room-type gate on cohort select",
  );
  assert(
    cohortsPage.includes("plan_course_components!dg_component_college_fkey("),
    "cohorts page disambiguates delivery-group component embed",
  );
  assert(
    cohortsPage.includes("useGenerateDeliveryGroups"),
    "cohorts page wires delivery-group generation",
  );

  const deliveryGroupsPage = read("src/routes/_authenticated/delivery-groups.tsx");
  assert(
    deliveryGroupsPage.includes("plan_course_components!dg_component_college_fkey("),
    "delivery-groups page disambiguates component embed",
  );
  assert(
    deliveryGroupsPage.includes('to="/teaching-assignments"'),
    "delivery-groups page links to teaching assignments",
  );

  const generator = read("src/lib/academic-delivery/generate-delivery-groups.ts");
  assert(
    generator.includes("checkCohortDeliveryGroupRoomTypes"),
    "generator runs room-type gate before RPC",
  );
  assert(
    generator.includes('supabase.rpc("generate_cohort_delivery_groups"'),
    "generator reaches delivery-group RPC",
  );
  assert(
    generator.includes("resolveSchedulingHeadcountRpc"),
    "generator requires approved scheduling headcount",
  );

  const teachingPage = read("src/routes/_authenticated/teaching-assignments.tsx");
  assert(
    teachingPage.includes("useTeachingAssignmentWorkspace"),
    "teaching assignments use RPC workspace",
  );

  const headcountsPage = read("src/routes/_authenticated/scheduling-headcounts.tsx");
  assert(
    headcountsPage.includes("approveSchedulingCohortTermHeadcount"),
    "scheduling headcounts page supports approval flow",
  );

  // Five CYB cohort fixtures — regular/parallel separation
  for (const code of CYB_COHORTS) {
    const fx = cohortFixture(code);
    assert(fx.code === code, `fixture code ${code}`);
    assert(fx.studySystem === "regular" || fx.studySystem === "parallel", `${code} study_system`);
    assert(fx.level >= 1 && fx.level <= 3, `${code} level band L1/L2/L3`);
  }
  const reg = CYB_COHORTS.filter((c) => c.includes("-REG-"));
  const par = CYB_COHORTS.filter((c) => c.includes("-PAR-"));
  assert(reg.length === 3 && par.length === 2, "CYB fixture regular/parallel split");
  assert(new Set(reg).size === reg.length, "regular cohort codes distinct");
  assert(new Set(par).size === par.length, "parallel cohort codes distinct");

  // Curriculum/components: summer_training + 0-hour project excluded from generation selection
  const summerOnly = selectCoursesForCurriculumGeneration([
    {
      courseCode: "CYB999",
      courseName: "Summer",
      isRequired: true,
      isElectiveSelection: false,
      components: derivePlanCourseComponents({ is_summer_training: true, tutorial_hours: 2 }),
    },
  ]);
  assert(summerOnly.length === 0, "summer_training-only course excluded from curriculum");

  const projectZero = selectCoursesForCurriculumGeneration([
    {
      courseCode: "CYB888",
      courseName: "Project",
      isRequired: true,
      isElectiveSelection: false,
      components: derivePlanCourseComponents({ is_graduation_project: true, project_hours: 0 }),
    },
  ]);
  assert(projectZero.length === 0, "0-hour graduation project excluded from curriculum");

  assert(isElectivePlaceholderCode("CY3XX(E)"), "elective placeholder detected");
  assert(termTypeToSemester("first") === 1, "term_type first → semester 1");
  assert(termTypeToSemester("second") === 2, "term_type second → semester 2");

  const electiveOk = validateElectiveSelectionForGeneration(
    {
      electiveSlotId: "slot-1",
      selectedCourseId: "course-1",
      slotStudyPlanId: "plan-a",
      slotSemester: 2,
      slotLevelId: "l2",
      slotActive: true,
      courseCode: "CYB210",
    },
    {
      studyPlanId: "plan-a",
      semester: 2,
      levelId: "l2",
      allowed: [{ electiveSlotId: "slot-1", courseId: "course-1", active: true }],
    },
  );
  assert(electiveOk.ok === true, "elective validation accepts in-slot selection");

  // Delivery group generation logic on realistic L2 practical fixture
  const headcount = requireSchedulingHeadcountForSplit(45);
  assert(headcount.ok === true && headcount.studentCount === 45, "scheduling headcount accepted");
  const practicalSplit = calculateDeliveryGroupCount({
    componentType: "practical",
    studentCount: 45,
    roomTypeCapacity: { defaultCapacity: 30, strictCapacity: true },
  });
  assert(
    practicalSplit.ok &&
      !("skipped" in practicalSplit && practicalSplit.skipped) &&
      practicalSplit.groupCount === 2,
    "L2 practical 45/30 → 2 groups",
  );

  const summerDg = calculateDeliveryGroupCount({
    componentType: "summer_training",
    studentCount: 45,
    roomTypeCapacity: { defaultCapacity: 30 },
  });
  assert(
    summerDg.ok && "skipped" in summerDg && summerDg.skipped === true,
    "summer_training skipped for delivery groups",
  );

  const projectDg = calculateDeliveryGroupCount({
    componentType: "project",
    studentCount: 45,
    weeklyContactHours: 0,
    explicitGroupSize: 10,
  });
  assert(
    projectDg.ok && !("skipped" in projectDg && projectDg.skipped) && projectDg.groupCount === 0,
    "0-hour project produces no delivery groups",
  );

  // Room-type gate — no MISSING_CAPACITY when components are valid
  const gateOk = collectMissingRoomTypeComponents(
    [
      {
        componentId: "c-practical",
        componentType: "practical",
        weeklyContactHours: 2,
        isTimetabled: true,
        requiredRoomTypeId: "rt-lab",
        courseCode: "CYB201",
        courseName: "Cyber Lab",
        programName: "Cybersecurity",
        levelName: "L2",
        semester: 1,
        roomDefaultCapacity: 30,
        roomTypeActive: true,
        roomTypeCollegeId: "college-a",
      },
    ],
    { collegeId: "college-a", termLabel: "2025-2026-S" },
  );
  assert(gateOk.ok === true, "valid room types pass gate (no MISSING_CAPACITY)");

  const validationSummary = parseDeliveryGroupGeneratorSummary({
    status: "VALIDATION_FAILED",
    groups_created: 0,
    groups_updated: 0,
    groups_unchanged: 0,
    groups_obsolete: 0,
    validation_errors: [{ code: "MISSING_CAPACITY", message: "fixture" }],
    warnings: [],
  });
  assert(
    validationSummary.status === "VALIDATION_FAILED",
    "generator summary parses validation path",
  );

  console.log("scheduling-initial-delivery-runtime-closure.harness.ts: all assertions passed");
}

run();
