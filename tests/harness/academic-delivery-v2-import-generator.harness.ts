/**
 * PHASE-9.2 — Academic Delivery Model V2 import + generator contracts (source only).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  derivePlanCourseComponents,
  electiveCourseDisplayLabel,
  isElectivePlaceholderCode,
  selectCoursesForCurriculumGeneration,
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

  // 5) summer training not scheduled
  const summer = derivePlanCourseComponents({ is_summer_training: true, training_hours: 4 });
  const s = summer.find((c) => c.component_type === "summer_training")!;
  assert(s.is_timetabled === false, "summer not timetabled");

  // 6) elective selection only — placeholder rejected
  assert(isElectivePlaceholderCode("CY3XX(E)"), "placeholder code");
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
  assert(again.length === 1 && again[0].courseCode === "CY301", "idempotent filter");

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
  assert(!importUi.includes('value: "course_offerings"'), "offerings hidden from import UI");
  assert(!importUi.includes('value: "teaching_assignments"'), "legacy TA hidden from import UI");
  assert(!importUi.includes('value: "sections"'), "sections hidden from import UI");
  assert(importUi.includes('value: "teaching_assignments_v2"'), "v2 TA in import UI");
  assert(importUi.includes('value: "academic_cohorts"'), "cohorts in import UI");

  const nav = read("src/components/app-layout.tsx");
  assert(!nav.includes('to: "/course-offerings"'), "offerings hidden from nav");

  const commit = read("src/lib/excel-import/commit.ts");
  assert(commit.includes("derivePlanCourseComponents"), "commit uses derivation");
  assert(commit.includes("syncPlanCourseComponents"), "components sync");
  assert(commit.includes("isElectivePlaceholderCode"), "placeholder guard");

  console.log("academic-delivery-v2-import-generator.harness.ts: PASS");
}

run();
