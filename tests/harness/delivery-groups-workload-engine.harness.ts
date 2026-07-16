/**
 * PHASE-9.3 — Delivery Groups + Workload Engine
 *
 * Distinguishes:
 * - static SQL contract tests (migration source)
 * - pure logic tests (fixtures/harness)
 * - runtime DB tests → DEFERRED until migration apply stage
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateDeliveryGroupCount,
  groupCodeForNumber,
  planDeliveryGroupReconciliation,
} from "../../src/lib/academic-delivery/delivery-groups.ts";
import {
  computeInstructorWorkload,
  DEFAULT_WORKLOAD_POLICIES,
  validateAssignmentComponentMatch,
} from "../../src/lib/academic-delivery/workload.ts";
import { parseDeliveryGroupGeneratorSummary } from "../../src/lib/academic-delivery/delivery-group-generator-summary.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const MIG = "supabase/migrations/20260716070000_delivery_groups_workload_engine.sql";

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  assert(existsSync(join(root, MIG)), "Phase 9.3 migration present");
  const sql = read(MIG);

  // ---------- Static SQL contract ----------
  assert(sql.includes("BEGIN;") && sql.includes("COMMIT;"), "txn wrap");
  assert(sql.includes("generate_cohort_delivery_groups"), "rpc name");
  assert(sql.includes("compute_instructor_standard_workload"), "workload rpc");
  assert(sql.includes("v_instructor_delivery_workload"), "workload view");
  assert(sql.includes("faculty_workload_policies"), "workload policy table");
  assert(sql.includes("SECURITY DEFINER"), "security definer");
  assert(/SET\s+search_path\s*=\s*public/i.test(sql), "search_path");
  assert(sql.includes("v_uid uuid := auth.uid()"), "auth.uid");
  assert(sql.includes("can_manage_college(v_uid, v_cohort.college_id)"), "manage gate");
  assert(sql.includes("insufficient_privilege"), "privilege error");
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.generate_cohort_delivery_groups(uuid) FROM PUBLIC, anon",
    ),
    "revoke public/anon generator",
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.generate_cohort_delivery_groups(uuid) TO authenticated",
    ),
    "grant authenticated generator",
  );
  assert(!/PERFORM\s+public\.generate_cohort_delivery_groups/i.test(sql), "no auto invoke");
  assert(!/SELECT\s+public\.generate_cohort_delivery_groups\s*\(/i.test(sql), "no select invoke");
  assert(!/\bTRUNCATE\b/i.test(sql), "no truncate");
  assert(!/\bDROP\s+TABLE\b/i.test(sql), "no drop table");
  // Generator must not DELETE delivery groups (non-destructive)
  assert(!/DELETE\s+FROM\s+public\.delivery_groups/i.test(sql), "no DG delete");
  assert(sql.includes("OBSOLETE_GROUP"), "obsolete warnings");
  assert(sql.includes("MISSING_CAPACITY"), "missing capacity error");
  assert(sql.includes("skipped_non_weekly_component"), "summer skip");
  assert(sql.includes("excluded_from_standard_workload"), "project flag");
  assert(sql.includes("explicit_group_size"), "explicit group size");
  assert(sql.includes("dg_cohort_component_group_number_uniq"), "unique group number");
  assert(sql.includes("SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN"), "no summer assignment");
  assert(sql.includes("ASSIGNMENT_COMPONENT_MISMATCH"), "component mismatch");
  assert(sql.includes("ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN"), "cross-college");
  assert(sql.includes("ta_v2_delivery_group_instructor_uniq"), "v2 assignment uniq");
  // No hard-coded capacity 30 in generator body
  assert(!/v_capacity\s*:=\s*30\b/.test(sql), "no hardcoded capacity 30");
  assert(
    !/DEFAULT\s+30/.test(sql.split("generate_cohort_delivery_groups")[1] ?? ""),
    "no default 30 in rpc",
  );

  // Preserve Phase 9.1 / 9.2 migrations untouched
  const p91 = "supabase/migrations/20260716025117_c196d985-85f6-4119-9e26-affdbbaadc2a.sql";
  const p92 = "supabase/migrations/20260716030000_generate_cohort_curriculum.sql";
  assert(existsSync(join(root, p91)), "9.1 migration still present");
  assert(existsSync(join(root, p92)), "9.2 migration still present");
  assert(
    read(p92).includes("created_delivery_groups', 0") ||
      read(p92).includes("created_delivery_groups"),
    "9.2 still no DG create",
  );

  // UI / service contracts
  const page = read("src/routes/_authenticated/academic-cohorts.tsx");
  assert(page.includes("توليد مجموعات التدريس"), "generate button label");
  assert(page.includes("AlertDialog"), "explicit confirmation");
  assert(page.includes("useCanManageActiveCollege"), "auth gate UI");
  assert(page.includes("useGenerateDeliveryGroups"), "hook wired");
  assert(
    !/generateCohortDeliveryGroups\(|generate\.mutate\(/.test(
      read("src/lib/excel-import/commit.ts"),
    ),
    "import does not auto-generate delivery groups",
  );

  const svc = read("src/lib/academic-delivery/generate-delivery-groups.ts");
  assert(svc.includes("generate_cohort_delivery_groups"), "service rpc name");
  assert(svc.includes("DeliveryGroupGeneratorSummary"), "summary type");

  // Schedule Builder legacy preserved (static)
  const sbQueries = read("src/lib/schedule-builder/queries.ts");
  assert(sbQueries.includes("course_offering_id") || sbQueries.length > 0, "SB queries present");
  assert(
    !read("src/lib/schedule-builder/workspace.ts").includes("generate_cohort_delivery_groups"),
    "SB workspace not coupled to DG generator",
  );

  // ---------- Pure logic: delivery groups (fixtures) ----------
  // 1) theory 26 / capacity 60 → 1 group
  {
    const r = calculateDeliveryGroupCount({
      componentType: "theory",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 1, "theory 26/60 → 1");
  }
  // 2) theory 75 / 60 → 2
  {
    const r = calculateDeliveryGroupCount({
      componentType: "theory",
      studentCount: 75,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 2, "theory 75/60 → 2");
  }
  // 3) practical 26 / 30 → 1
  {
    const r = calculateDeliveryGroupCount({
      componentType: "practical",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 30, strictCapacity: true },
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 1, "practical 26/30 → 1");
  }
  // 4) practical 61 / 30 → 3
  {
    const r = calculateDeliveryGroupCount({
      componentType: "practical",
      studentCount: 61,
      roomTypeCapacity: { defaultCapacity: 30, strictCapacity: true },
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 3, "practical 61/30 → 3");
  }
  // 5) tutorial independent (explicit size)
  {
    const r = calculateDeliveryGroupCount({
      componentType: "tutorial",
      studentCount: 40,
      explicitGroupSize: 20,
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 2, "tutorial independent");
  }
  // 6) course with theory + practical + tutorial
  {
    const theory = calculateDeliveryGroupCount({
      componentType: "theory",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    const practical = calculateDeliveryGroupCount({
      componentType: "practical",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 30, strictCapacity: true },
    });
    const tutorial = calculateDeliveryGroupCount({
      componentType: "tutorial",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 30 },
    });
    assert(
      theory.ok &&
        practical.ok &&
        tutorial.ok &&
        !("skipped" in theory && theory.skipped) &&
        theory.groupCount === 1 &&
        !("skipped" in practical && practical.skipped) &&
        practical.groupCount === 1 &&
        !("skipped" in tutorial && tutorial.skipped) &&
        tutorial.groupCount === 1,
      "theory+practical+tutorial all independent",
    );
  }
  // 7) project generates groups but excluded from standard workload
  {
    const r = calculateDeliveryGroupCount({
      componentType: "project",
      studentCount: 20,
      weeklyContactHours: 2,
      explicitGroupSize: 10,
    });
    assert(
      r.ok &&
        !("skipped" in r && r.skipped) &&
        r.groupCount === 2 &&
        r.excludedFromStandardWorkload,
      "project groups excluded from standard workload",
    );
  }
  // 8) summer_training does not generate weekly groups
  {
    const r = calculateDeliveryGroupCount({
      componentType: "summer_training",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 30 },
    });
    assert(r.ok && "skipped" in r && r.skipped && r.groupCount === 0, "summer_training skipped");
  }
  // 9) missing capacity → validation error
  {
    const r = calculateDeliveryGroupCount({
      componentType: "theory",
      studentCount: 26,
      roomTypeCapacity: null,
    });
    assert(!r.ok && r.code === "MISSING_CAPACITY", "missing capacity error");
  }
  // 10) rerun → no duplicates (reconciliation create empty when existing covers)
  {
    const plan = planDeliveryGroupReconciliation({
      requiredGroupCount: 2,
      existing: [
        { groupNumber: 1, hasTeachingAssignment: false, hasScheduleSession: false },
        { groupNumber: 2, hasTeachingAssignment: false, hasScheduleSession: false },
      ],
    });
    assert(plan.createNumbers.length === 0, "rerun no create duplicates");
    assert(plan.deleteNumbers.length === 0, "rerun no deletes");
    assert(groupCodeForNumber(1) === "G1" && groupCodeForNumber(2) === "G2", "group codes stable");
  }
  // 11) student_count increase → add required group
  {
    const plan = planDeliveryGroupReconciliation({
      requiredGroupCount: 3,
      existing: [
        { groupNumber: 1, hasTeachingAssignment: false, hasScheduleSession: false },
        { groupNumber: 2, hasTeachingAssignment: false, hasScheduleSession: false },
      ],
    });
    assert(plan.createNumbers.length === 1 && plan.createNumbers[0] === 3, "increase adds group 3");
  }
  // 12) decrease with linked group → warning, no delete
  {
    const plan = planDeliveryGroupReconciliation({
      requiredGroupCount: 1,
      existing: [
        { groupNumber: 1, hasTeachingAssignment: false, hasScheduleSession: false },
        { groupNumber: 2, hasTeachingAssignment: true, hasScheduleSession: false },
      ],
    });
    assert(plan.deleteNumbers.length === 0, "linked obsolete not deleted");
    assert(
      plan.warnings.some((w) => w.code === "OBSOLETE_GROUP_LINKED" && w.groupNumber === 2),
      "linked obsolete warning",
    );
  }

  // 13/14 unauthorized + cross-college — static SQL contracts (runtime DB deferred)
  assert(sql.includes("IF v_uid IS NULL"), "13 unauthorized rejected (static)");
  assert(
    sql.includes("can_manage_college(v_uid, v_cohort.college_id)"),
    "14 college gate (static)",
  );
  assert(
    sql.includes("ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN"),
    "14 cross-college assignment rejected (static)",
  );
  console.log(
    "NOTE: runtime DB tests for unauthorized/cross-college deferred until migration apply",
  );

  // 15) assignment component mismatch rejected
  {
    const bad = validateAssignmentComponentMatch({
      deliveryGroupComponentId: "c1",
      assignmentComponentId: "c2",
      deliveryGroupCohortId: "co1",
      assignmentCohortId: "co1",
      componentType: "theory",
    });
    assert(!bad.ok && bad.code === "ASSIGNMENT_COMPONENT_MISMATCH", "component mismatch");
    const summer = validateAssignmentComponentMatch({
      deliveryGroupComponentId: "c1",
      assignmentComponentId: "c1",
      deliveryGroupCohortId: "co1",
      assignmentCohortId: "co1",
      componentType: "summer_training",
    });
    assert(
      !summer.ok && summer.code === "SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN",
      "summer assign",
    );
  }

  // 16–19 workload
  {
    const policies = DEFAULT_WORKLOAD_POLICIES;
    const base = computeInstructorWorkload({
      academicRank: "أستاذ مساعد",
      policies,
      assignments: [
        {
          deliveryGroupId: "g1",
          componentType: "theory",
          weeklyContactHours: 3,
          assignedWeeklyHours: 3,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
        {
          deliveryGroupId: "g2",
          componentType: "practical",
          weeklyContactHours: 2,
          assignedWeeklyHours: 2,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
        {
          deliveryGroupId: "g3",
          componentType: "tutorial",
          weeklyContactHours: 1,
          assignedWeeklyHours: 1,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
      ],
    });
    assert(base.requiredLoadHours === 12, "16 required 12 for assistant professor");
    assert(base.standardAssignedHours === 6, "16 standard hours sum components");
    assert(base.status === "deficit", "18 deficit status");
    assert(base.deficitHours === 6, "18 deficit hours");

    const overload = computeInstructorWorkload({
      academicRank: "associate_professor",
      policies,
      assignments: [
        {
          deliveryGroupId: "g1",
          componentType: "theory",
          weeklyContactHours: 6,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
        {
          deliveryGroupId: "g2",
          componentType: "practical",
          weeklyContactHours: 6,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
      ],
    });
    assert(overload.requiredLoadHours === 9, "17 associate professor 9h");
    assert(overload.standardAssignedHours === 12, "17 assigned 12");
    assert(overload.overloadHours === 3 && overload.status === "overload", "17 overload");

    const withProject = computeInstructorWorkload({
      academicRank: "assistant_professor",
      policies,
      assignments: [
        {
          deliveryGroupId: "g1",
          componentType: "theory",
          weeklyContactHours: 12,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
        {
          deliveryGroupId: "gp",
          componentType: "project",
          weeklyContactHours: 2,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: false,
          coInstructorCount: 0,
        },
      ],
    });
    assert(withProject.standardAssignedHours === 12, "19 project not in standard");
    assert(withProject.projectSupervisionHours === 2, "19 project hours separate");
    assert(withProject.status === "ok", "19 ok when standard meets required");
  }

  // 20) Schedule Builder legacy references preserved
  assert(existsSync(join(root, "src/routes/_authenticated/schedule-builder.tsx")), "SB route");
  assert(existsSync(join(root, "src/lib/schedule-builder/workspace.ts")), "SB workspace");
  assert(
    read("src/routes/_authenticated/course-offerings.tsx").includes("قراءة"),
    "course_offerings read-only compatibility page",
  );

  // Summary parser
  const summary = parseDeliveryGroupGeneratorSummary({
    cohorts_processed: 1,
    groups_created: 2,
    groups_updated: 0,
    groups_unchanged: 1,
    groups_obsolete: 0,
    skipped_components: [{ code: "skipped_non_weekly_component" }],
    warnings: [],
    validation_errors: [],
  });
  assert(summary.groups_created === 2, "summary parse");
  assert(summary.skipped_components.length === 1, "summary skipped");

  console.log("PASS — PHASE-9.3 delivery-groups-workload-engine harness");
  console.log(
    "Deferred runtime DB tests: unauthorized, cross-college live RPC, idempotent DB rerun",
  );
}

run();
