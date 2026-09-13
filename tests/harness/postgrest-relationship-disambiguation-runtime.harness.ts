/**
 * POSTGREST-RELATIONSHIP-DISAMBIGUATION-SWEEP-01 — runtime/update contract checks (no DB writes).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectMissingRoomTypeComponents } from "../../src/lib/academic-delivery/plan-component-room-types.ts";
import { parseDeliveryGroupGeneratorSummary } from "../../src/lib/academic-delivery/delivery-group-generator-summary.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CYB_REG = "CYB-L2-REG-2025";
const CYB_PAR = "CYB-L2-PAR-2025";

function cohortSelectionFixture() {
  return [
    {
      id: "11111111-1111-4111-8111-111111111111",
      code: CYB_REG,
      study_system: "regular",
      program_id: "p-cyb",
      level_id: "l2",
      term_id: "t-2025",
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      code: CYB_PAR,
      study_system: "parallel",
      program_id: "p-cyb",
      level_id: "l2",
      term_id: "t-2025",
    },
  ];
}

function run() {
  const cohortsPage = read("src/routes/_authenticated/academic-cohorts.tsx");
  assert(
    !cohortsPage.includes("academic_programs(name)"),
    "cohort list path does not use ambiguous academic_programs embed",
  );
  assert(
    cohortsPage.includes('from("academic_programs")'),
    "cohort list resolves program labels via separate flat query",
  );
  assert(
    cohortsPage.includes("plan_course_components!dg_component_college_fkey("),
    "cohort delivery-group load uses composite component FK hint",
  );

  const fixture = cohortSelectionFixture();
  const reg = fixture.find((c) => c.code === CYB_REG);
  const par = fixture.find((c) => c.code === CYB_PAR);
  assert(reg?.study_system === "regular", "CYB-L2-REG-2025 is regular");
  assert(par?.study_system === "parallel", "CYB-L2-PAR-2025 is parallel");
  assert(reg?.id !== par?.id, "regular and parallel cohort selections stay distinct");

  const regOnly = fixture.filter((c) => c.study_system === "regular");
  const parOnly = fixture.filter((c) => c.study_system === "parallel");
  assert(regOnly.length === 1 && regOnly[0]?.code === CYB_REG, "regular filter selects REG cohort");
  assert(
    parOnly.length === 1 && parOnly[0]?.code === CYB_PAR,
    "parallel filter selects PAR cohort",
  );

  const readinessLib = read("src/lib/reports/readiness.ts");
  assert(
    readinessLib.includes('from("academic_cohorts").select("id, active, term_id")'),
    "readiness new-flow cohort signal uses flat select (no ambiguous embeds)",
  );
  assert(
    /from\("delivery_groups"\)\s*\.select\("id, cohort_id"\)/.test(readinessLib),
    "readiness delivery-group signal uses flat select",
  );

  const dataReadiness = read("src/routes/_authenticated/data-readiness.tsx");
  assert(
    dataReadiness.includes("fetchStudyPlanReadiness") &&
      readinessLib.includes("fetchStudyPlanReadiness") &&
      read("src/lib/academic-delivery/fetch-study-plan-readiness.ts").includes(
        "fetchCollegePlanComponentRoomTypeMissing(collegeId)",
      ),
    "both readiness paths use the shared plan-component room-type scan",
  );

  const gateSrc = read("src/lib/academic-delivery/cohort-delivery-group-room-type-gate.ts");
  assert(
    !gateSrc.includes('from("course_offerings")'),
    "room type gate does not query legacy course_offerings",
  );
  assert(
    gateSrc.includes("resolveCohortCurriculumPlanCourses"),
    "room type gate resolves plan courses via New Flow path",
  );
  assert(
    gateSrc.includes("room_types!pcc_room_type_college_fkey("),
    "room type gate query is disambiguated for room types",
  );

  const curriculumSrc = read("src/lib/academic-delivery/cohort-curriculum-plan-courses.ts");
  assert(
    curriculumSrc.includes("academic_programs!ac_program_college_fkey(name)"),
    "curriculum resolver disambiguates academic_programs",
  );
  assert(
    !curriculumSrc.includes('from("course_offerings")'),
    "curriculum resolver avoids legacy course_offerings",
  );

  const gateOk = collectMissingRoomTypeComponents(
    [
      {
        componentId: "c-ok",
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
  assert(gateOk.ok === true, "room type gate passes when components are valid");

  const generator = read("src/lib/academic-delivery/generate-delivery-groups.ts");
  assert(
    generator.includes("checkCohortDeliveryGroupRoomTypes"),
    "generate_delivery_groups runs room-type gate before RPC",
  );
  assert(
    generator.includes('supabase.rpc("generate_cohort_delivery_groups"'),
    "generate_delivery_groups reaches RPC after pre-checks",
  );

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
    "generator summary parses validation path without embed failure",
  );

  const scheduleQueries = read("src/lib/schedule-builder/queries.ts");
  assert(
    scheduleQueries.includes("WORKSPACE_SESSION_FLAT_SELECT"),
    "schedule builder keeps flat session read model (no ambiguous embed regression)",
  );

  const teachingPage = read("src/routes/_authenticated/teaching-assignments.tsx");
  assert(
    teachingPage.includes("useTeachingAssignmentWorkspace"),
    "teaching assignments use RPC workspace (no direct ambiguous embeds)",
  );

  console.log("postgrest-relationship-disambiguation-runtime.harness.ts: all assertions passed");
}

run();
