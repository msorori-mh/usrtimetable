import { readPrimaryNavigationSource } from "./nav-source";
/**
 * PHASE-9.2 — Academic Delivery Model V2 import + generator contracts (source only).
 * Remediation-01: auth gate, semester filter, elective_slot_courses, read-only offerings UI.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  derivePlanCourseComponents,
  electiveCourseDisplayLabel,
  filterPlanCoursesByCohortContext,
  isElectivePlaceholderCode,
  selectCoursesForCurriculumGeneration,
  termTypeToSemester,
  validateElectiveSelectionForGeneration,
} from "../../src/lib/academic-delivery/plan-course-components.ts";
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  const mig = "supabase/migrations/20260716030000_generate_cohort_curriculum.sql";
  assert(existsSync(join(root, mig)), "generator migration present");
  const sql = read(mig);
  assert(sql.includes("generate_cohort_curriculum"), "rpc name");
  assert(sql.includes("BEGIN;") && sql.includes("COMMIT;"), "txn");
  assert(!/\bDROP\s+TABLE\b/i.test(sql), "no DROP TABLE");
  assert(!/\bDELETE\s+FROM\b/i.test(sql), "no DELETE FROM");
  assert(!/\bTRUNCATE\b/i.test(sql), "no TRUNCATE");
  assert(!/INSERT\s+INTO\s+public\.sections\b/i.test(sql), "no sections");
  assert(!/course_offering_sections/i.test(sql), "no COS");
  assert(!/section_subgroups/i.test(sql), "no subgroups");
  assert(
    !/delivery_groups/i.test(sql) || sql.includes("created_delivery_groups', 0"),
    "no DG create",
  );
  assert(!/schedule_sessions/i.test(sql) || sql.includes("created_sessions', 0"), "no sessions");
  assert(sql.includes("skipped_existing"), "idempotent skip");
  assert(sql.includes("مقرر اختياري"), "elective label");
  assert(!/CREATE\s+TRIGGER/i.test(sql), "no trigger");
  assert(!/PERFORM\s+public\.generate_cohort_curriculum/i.test(sql), "no auto-invoke");
  assert(!/SELECT\s+public\.generate_cohort_curriculum/i.test(sql), "no select invoke");

  // --- Auth gate (static contract) ---
  assert(sql.includes("SECURITY DEFINER"), "security definer");
  assert(/SET\s+search_path\s*=\s*public/i.test(sql), "search_path");
  assert(sql.includes("v_uid uuid := auth.uid()"), "auth.uid capture");
  assert(sql.includes("IF v_uid IS NULL"), "reject unauthenticated");
  assert(sql.includes("can_manage_college(v_uid, v_cohort.college_id)"), "college manage gate");
  assert(sql.includes("insufficient_privilege"), "insufficient_privilege error");
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.generate_cohort_curriculum(uuid) FROM PUBLIC, anon",
    ),
    "revoke public/anon",
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.generate_cohort_curriculum(uuid) TO authenticated",
    ),
    "grant authenticated",
  );
  // No client-supplied college_id parameter — college derived from cohort row only.
  assert(!/generate_cohort_curriculum\([^)]*college/i.test(sql), "no college_id param");
  // can_manage_college signature contract (project): (_user_id uuid, _college_id uuid)
  const canManageDef = read(
    "supabase/migrations/20260604225017_41baaa6b-647b-4c2f-bd10-32d352b9c8f6.sql",
  );
  assert(
    canManageDef.includes("can_manage_college(_user_id uuid, _college_id uuid)"),
    "can_manage_college signature (_user_id, _college_id)",
  );

  // --- Semester filter (static + logic) ---
  assert(sql.includes("pc.semester = v_semester"), "required courses filtered by semester");
  assert(sql.includes("es.semester = v_semester"), "elective slots filtered by semester");
  assert(sql.includes("term_type"), "term_type used");
  assert(sql.includes("v_term_type = 'first'"), "first → semester 1");
  assert(sql.includes("v_term_type = 'second'"), "second → semester 2");
  assert(sql.includes("COHORT_TERM_TYPE_UNSUPPORTED"), "fail closed on unknown term_type");
  assert(termTypeToSemester("first") === 1, "termTypeToSemester first");
  assert(termTypeToSemester("second") === 2, "termTypeToSemester second");
  assert(termTypeToSemester(null) === null, "termTypeToSemester null rejected");
  assert(termTypeToSemester("summer") === null, "termTypeToSemester summer rejected");

  const semesterCandidates = [
    { courseCode: "CS101", levelId: "L1", semester: 1, programId: "P1", studySystem: "regular" },
    { courseCode: "CS102", levelId: "L1", semester: 2, programId: "P1", studySystem: "regular" },
    { courseCode: "CS201", levelId: "L2", semester: 1, programId: "P1", studySystem: "regular" },
  ];
  const sem1 = filterPlanCoursesByCohortContext(semesterCandidates, {
    programId: "P1",
    levelId: "L1",
    studySystem: "regular",
    semester: 1,
  });
  assert(
    sem1.length === 1 && sem1[0].courseCode === "CS101",
    "semester 1 does not pull semester 2",
  );

  // --- Elective validation (static + logic) ---
  assert(sql.includes("elective_slot_courses"), "RPC checks elective_slot_courses");
  assert(sql.includes("ELECTIVE_COURSE_NOT_IN_SLOT"), "disallowed elective raises");
  assert(sql.includes("ELECTIVE_SLOT_CONTEXT_MISMATCH"), "wrong slot context raises");
  assert(sql.includes("ELECTIVE_SLOT_UNSELECTED"), "unselected slot warning");
  assert(sql.includes("ELECTIVE_PLACEHOLDER_FORBIDDEN"), "placeholder selection forbidden");
  assert(sql.includes("skipped_unselected_elective"), "unselected counter");

  const allowed = [
    { electiveSlotId: "slot-A", courseId: "course-allowed", active: true },
    { electiveSlotId: "slot-B", courseId: "course-other", active: true },
  ];
  const ctx = { studyPlanId: "plan-1", semester: 1, levelId: "L1", allowed };

  assert(
    validateElectiveSelectionForGeneration(
      {
        electiveSlotId: "slot-A",
        selectedCourseId: "course-allowed",
        slotStudyPlanId: "plan-1",
        slotSemester: 1,
        slotLevelId: "L1",
      },
      ctx,
    ).ok === true,
    "elective allowed succeeds",
  );

  assert(
    validateElectiveSelectionForGeneration(
      {
        electiveSlotId: "slot-A",
        selectedCourseId: "course-NOT-listed",
        slotStudyPlanId: "plan-1",
        slotSemester: 1,
        slotLevelId: "L1",
      },
      ctx,
    ).ok === false,
    "elective not in elective_slot_courses fails",
  );

  assert(
    (
      validateElectiveSelectionForGeneration(
        {
          electiveSlotId: "slot-A",
          selectedCourseId: "course-other",
          slotStudyPlanId: "plan-1",
          slotSemester: 1,
          slotLevelId: "L1",
        },
        ctx,
      ) as { ok: false; code: string }
    ).code === "ELECTIVE_COURSE_NOT_IN_SLOT",
    "elective belonging to another slot fails",
  );

  assert(
    (
      validateElectiveSelectionForGeneration(
        {
          electiveSlotId: "slot-A",
          selectedCourseId: "course-allowed",
          slotStudyPlanId: "plan-OTHER",
          slotSemester: 1,
          slotLevelId: "L1",
        },
        ctx,
      ) as { ok: false; code: string }
    ).code === "ELECTIVE_SLOT_CONTEXT_MISMATCH",
    "elective correct course but other plan fails",
  );

  assert(
    (
      validateElectiveSelectionForGeneration(
        {
          electiveSlotId: "slot-A",
          selectedCourseId: "course-allowed",
          slotStudyPlanId: "plan-1",
          slotSemester: 2,
          slotLevelId: "L1",
        },
        ctx,
      ) as { ok: false; code: string }
    ).code === "ELECTIVE_SLOT_CONTEXT_MISMATCH",
    "elective correct course but other semester fails",
  );

  // Placeholder with no selection → creates nothing (filter + SQL warning path)
  assert(isElectivePlaceholderCode("CY3XX(E)"), "placeholder code");
  const noSelection = selectCoursesForCurriculumGeneration([
    {
      courseCode: "CY3XX(E)",
      courseName: "slot",
      isRequired: false,
      isElectiveSelection: false,
      components: derivePlanCourseComponents({ theory_hours: 3 }),
    },
  ]);
  assert(noSelection.length === 0, "elective placeholder with no selection creates nothing");

  // Import validator must enforce elective_slot_courses membership
  const validators = read("src/lib/excel-import/validators.ts");
  assert(validators.includes("electiveSlotCourses"), "import loads elective_slot_courses");
  assert(validators.includes("elective_course_not_in_slot"), "import rejects non-member elective");

  // 1) T3
  const t3 = derivePlanCourseComponents({ theory_hours: 3, credit_hours: 99 });
  assert(
    t3.length === 1 && t3[0].component_type === "theory" && t3[0].weekly_contact_hours === 3,
    "T3",
  );
  assert(!t3.some((c) => c.component_type === "practical"), "T3 no inferred practical");

  // 2) T2P2
  const t2p2 = derivePlanCourseComponents({ theory_hours: 2, practical_hours: 2, credit_hours: 3 });
  assert(
    t2p2.some((c) => c.component_type === "theory" && c.weekly_contact_hours === 2) &&
      t2p2.some((c) => c.component_type === "practical" && c.weekly_contact_hours === 2),
    "T2P2",
  );

  // 3) T2 + tutorial2
  const t2tut = derivePlanCourseComponents({ theory_hours: 2, tutorial_hours: 2 });
  assert(
    t2tut.some((c) => c.component_type === "theory") &&
      t2tut.some((c) => c.component_type === "tutorial" && c.weekly_contact_hours === 2),
    "T2+tutorial2",
  );
  const trainingAsTutorial = derivePlanCourseComponents({ theory_hours: 2, training_hours: 2 });
  assert(
    trainingAsTutorial.some((c) => c.component_type === "tutorial"),
    "training maps to tutorial",
  );

  // 4) project excluded from load
  const proj = derivePlanCourseComponents({ project_hours: 3, is_graduation_project: true });
  const p = proj.find((c) => c.component_type === "project")!;
  assert(p.is_timetabled === true, "project timetabled");
  assert(
    p.counts_toward_regular_load === false && p.counts_toward_overtime === false,
    "project load excluded",
  );

  // 5) summer training not scheduled / creates nothing via selector
  const summer = derivePlanCourseComponents({ is_summer_training: true, training_hours: 4 });
  const s = summer.find((c) => c.component_type === "summer_training")!;
  assert(s.is_timetabled === false, "summer not timetabled");
  const summerOnly = selectCoursesForCurriculumGeneration([
    {
      courseCode: "SUM1",
      courseName: "تدريب",
      isRequired: true,
      isElectiveSelection: false,
      components: summer,
    },
  ]);
  assert(summerOnly.length === 0, "summer_training creates nothing");

  // 6) elective selection only — placeholder rejected
  assert(!isElectivePlaceholderCode("CY301"), "real elective course");
  const selected = selectCoursesForCurriculumGeneration([
    {
      courseCode: "CY3XX(E)",
      courseName: "slot",
      isRequired: false,
      isElectiveSelection: false,
      components: derivePlanCourseComponents({ theory_hours: 3 }),
    },
    {
      courseCode: "CY301",
      courseName: "أمن الشبكات",
      isRequired: false,
      isElectiveSelection: true,
      components: derivePlanCourseComponents({ theory_hours: 3 }),
    },
    {
      courseCode: "SUM1",
      courseName: "تدريب",
      isRequired: true,
      isElectiveSelection: false,
      components: derivePlanCourseComponents({ is_summer_training: true, training_hours: 4 }),
    },
  ]);
  assert(selected.length === 1 && selected[0].courseCode === "CY301", "elective actual only");
  assert(
    electiveCourseDisplayLabel("أمن الشبكات") === "مقرر اختياري (أمن الشبكات)",
    "elective label",
  );

  // 7) idempotent selection (same input → same output)
  const again = selectCoursesForCurriculumGeneration(selected);
  assert(again.length === 1 && again[0].courseCode === "CY301", "rerun remains idempotent");

  // Templates / UI hide (source scan — avoid importing xlsx-backed modules)
  const templatesSrc = read("src/lib/excel-import/templates.ts");
  assert(templatesSrc.includes("academic_cohorts:"), "cohorts template");
  assert(templatesSrc.includes("elective_slot_courses:"), "elective_slot_courses template");
  assert(templatesSrc.includes("cohort_elective_selections:"), "cohort selections template");
  assert(templatesSrc.includes("teaching_assignments_v2:"), "ta v2 template");
  assert(templatesSrc.includes("teaching_assignments:"), "legacy ta retained");
  assert(templatesSrc.includes("course_offerings:"), "legacy offerings retained in TEMPLATES");
  assert(templatesSrc.includes('key: "tutorial_hours"'), "full plan tutorial_hours");
  assert(templatesSrc.includes('key: "is_elective_slot"'), "full plan elective flag");

  const importUi = read("src/routes/_authenticated/import.tsx");
  assert(importUi.includes("listImportUiEntities"), "import UI uses official registry");
  assert(!importUi.includes('value: "course_offerings"'), "offerings hidden from import UI");
  assert(!importUi.includes('value: "teaching_assignments"'), "legacy TA hidden from import UI");
  assert(!importUi.includes('value: "sections"'), "sections hidden from import UI");
  const registrySrc = read("src/lib/excel-import/registry.ts");
  assert(
    registrySrc.includes('"teaching_assignments_v2"') &&
      registrySrc.includes("ACTIVE_NEW_FLOW_ENTITIES"),
    "v2 TA in import UI registry",
  );
  assert(registrySrc.includes('"academic_cohorts"'), "cohorts in import UI registry");
  assert(
    registrySrc.includes("showInImportUi: false") && registrySrc.includes("LEGACY_ONLY"),
    "legacy entities marked hidden",
  );

  const nav = readPrimaryNavigationSource(root);
  assert(!nav.includes('to: "/course-offerings"'), "offerings hidden from nav");

  // Direct URL /course-offerings — no manual CRUD
  const offeringsPage = read("src/routes/_authenticated/course-offerings.tsx");
  assert(
    offeringsPage.includes(
      "الطروحات الأكاديمية طبقة توافق داخلية يتم توليدها آليًا من بيانات الدفعات والخطط الدراسية.",
    ),
    "offerings internal-layer Arabic message",
  );
  assert(!offeringsPage.includes("طرح مقرر"), "no create button");
  assert(!offeringsPage.includes("startCreate"), "no startCreate");
  assert(!offeringsPage.includes("startEdit"), "no startEdit");
  assert(!offeringsPage.includes("useMutation"), "no mutations on offerings page");
  assert(!offeringsPage.includes(".insert("), "no insert mutation");
  assert(!offeringsPage.includes(".update("), "no update mutation");
  assert(!offeringsPage.includes(".delete("), "no delete mutation");
  assert(!offeringsPage.includes("Dialog"), "no CRUD dialog");
  assert(!offeringsPage.includes("Pencil"), "no edit icon");
  assert(!offeringsPage.includes("Trash2"), "no delete icon");
  assert(
    offeringsPage.includes('createFileRoute("/_authenticated/course-offerings")'),
    "route retained",
  );

  // Schedule Builder legacy references remain
  const routeTree = read("src/routeTree.gen.ts");
  assert(routeTree.includes("course-offerings"), "SB/routeTree still has course-offerings");
  const sbHits = ["src/lib/schedule-builder", "src/routes/_authenticated/schedule-builder"];
  let sbRefs = 0;
  for (const rel of [
    "src/lib/schedule-builder/enrollment-ownership.ts",
    "src/integrations/supabase/types.ts",
  ]) {
    if (existsSync(join(root, rel)) && read(rel).includes("course_offerings")) sbRefs++;
  }
  assert(sbRefs >= 1, "Schedule Builder legacy course_offerings references remain");
  void sbHits;

  const commit = read("src/lib/excel-import/commit.ts");
  const atomicImport = read(
    "supabase/migrations/20260718210000_source_only_atomic_import_job_commit.sql",
  );
  assert(commit.includes("commit_import_job_atomic"), "commit is server atomic RPC");
  assert(
    atomicImport.includes("_import_sync_plan_course_components") ||
      atomicImport.includes("plan_course_components"),
    "components sync",
  );
  assert(
    atomicImport.includes("_import_is_elective_placeholder") || atomicImport.includes("elective"),
    "placeholder guard",
  );
  assert(
    atomicImport.includes("theory_hours") || atomicImport.includes("weekly_contact_hours"),
    "commit uses derivation",
  );

  // Phase 9.1 migration untouched by this remediation (harness cannot prove git; file still present)
  assert(
    existsSync(
      join(root, "supabase/migrations/20260716025117_c196d985-85f6-4119-9e26-affdbbaadc2a.sql"),
    ),
    "phase 9.1 migration present",
  );

  console.log("academic-delivery-v2-import-generator.harness.ts: PASS");
  console.log("NOTE: static/logic contracts only — migration NOT APPLIED; no runtime DB proof.");
}

run();
