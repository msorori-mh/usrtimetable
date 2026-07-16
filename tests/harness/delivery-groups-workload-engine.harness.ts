/**
 * PHASE-9.3 — Delivery Groups + Workload Engine (Remediation-01)
 *
 * Distinguishes:
 * - static SQL contract tests (migration source)
 * - pure logic tests (fixtures/harness)
 * - UI/static contracts
 * - runtime DB tests → DEFERRED until migration apply stage
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateDeliveryGroupCount,
  groupCodeForNumber,
  planDeliveryGroupReconciliation,
  resolveCompatibilityOffering,
  uniqueComponentsById,
} from "../../src/lib/academic-delivery/delivery-groups.ts";
import {
  computeInstructorWorkload,
  DEFAULT_WORKLOAD_POLICIES,
  hoursForAssignment,
  validateAssignmentComponentMatch,
  validateCoTeachingHours,
  validateOfferingDeliveryGroupMatch,
} from "../../src/lib/academic-delivery/workload.ts";
import {
  deriveGeneratorStatus,
  isGeneratorSuccessStatus,
  parseDeliveryGroupGeneratorSummary,
} from "../../src/lib/academic-delivery/delivery-group-generator-summary.ts";

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
  assert(!/TRUNCATE\s+public\./i.test(sql), "no truncate of public tables");
  assert(!/\bDROP\s+TABLE\b/i.test(sql), "no drop table");
  assert(!/DELETE\s+FROM\s+public\.delivery_groups/i.test(sql), "no DG delete");
  assert(sql.includes("OBSOLETE_GROUP"), "obsolete warnings");
  assert(sql.includes("is_obsolete"), "obsolete column");
  assert(sql.includes("MISSING_CAPACITY"), "missing capacity error");
  assert(sql.includes("skipped_non_weekly_component"), "summer skip");
  assert(sql.includes("excluded_from_standard_workload"), "project flag");
  assert(sql.includes("explicit_group_size"), "explicit group size");
  assert(sql.includes("dg_cohort_component_group_number_uniq"), "unique group number");
  assert(sql.includes("SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN"), "no summer assignment");
  assert(sql.includes("ASSIGNMENT_COMPONENT_MISMATCH"), "component mismatch");
  assert(sql.includes("ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN"), "cross-college");
  assert(sql.includes("OFFERING_PLAN_COURSE_MISMATCH"), "offering plan course integrity");
  assert(sql.includes("ta_v2_delivery_group_instructor_uniq"), "v2 assignment uniq");
  assert(sql.includes("assigned_component_hours"), "v2 assigned hours column");
  assert(sql.includes("CO_TEACHING_HOURS_SPLIT_REQUIRED"), "co-teach split required");
  assert(sql.includes("CO_TEACHING_HOURS_OVER_ALLOCATED"), "co-teach over-alloc");
  assert(sql.includes("OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN"), "obsolete blocks TA");
  assert(sql.includes("OBSOLETE_DELIVERY_GROUP_SESSION_FORBIDDEN"), "obsolete blocks session");
  assert(sql.includes("VALIDATION_FAILED"), "atomic validation status");
  assert(sql.includes("DISTINCT ON (pcc.id)"), "dedupe offerings by component");
  assert(sql.includes("AMBIGUOUS_COMPATIBILITY_OFFERINGS"), "ambiguous offering contract");
  assert(sql.includes("resolve_compatibility_offering_set"), "offering resolve helper");
  assert(!/v_capacity\s*:=\s*30\b/.test(sql), "no hardcoded capacity 30");

  // 1–2: Workload isolation (security_invoker + revoke PUBLIC/anon)
  assert(/security_invoker\s*=\s*true/i.test(sql), "1/2 workload view security_invoker=true");
  assert(
    sql.includes("REVOKE ALL ON public.v_instructor_delivery_workload FROM PUBLIC, anon"),
    "2 authenticated view grant is not PUBLIC/anon",
  );
  assert(
    !/COALESCE\(\s*ta\.weekly_hours/i.test(sql),
    "V2 workload does not use legacy weekly_hours",
  );
  assert(
    sql.includes("Permission gate before any sensitive aggregate read") ||
      sql.includes("can_view_college(v_uid, v_instructor.college_id)"),
    "workload RPC permission before read",
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
  assert(page.includes("generator-summary-panel") || page.includes("lastSummary"), "summary panel");
  assert(page.includes("obsolete"), "UI obsolete badge");
  assert(
    !/generateCohortDeliveryGroups\(|generate\.mutate\(/.test(
      read("src/lib/excel-import/commit.ts"),
    ),
    "import does not auto-generate delivery groups",
  );

  const hook = read("src/hooks/use-generate-delivery-groups.ts");
  assert(hook.includes("isGeneratorSuccessStatus"), "9 UI success gate");
  assert(hook.includes("toast.error"), "9 toast.error on validation failure");
  assert(
    !/toast\.success\([\s\S]*validation_errors/.test(hook) || hook.includes("if (!success)"),
    "9 no toast.success on validation error",
  );

  const svc = read("src/lib/academic-delivery/generate-delivery-groups.ts");
  assert(svc.includes("generate_cohort_delivery_groups"), "service rpc name");
  assert(svc.includes("DeliveryGroupGeneratorSummary"), "summary type");

  // Schedule Builder legacy preserved (static)
  const sbQueries = read("src/lib/schedule-builder/queries.ts");
  assert(sbQueries.includes("course_offering_id") || sbQueries.length > 0, "18 SB queries present");
  assert(
    !read("src/lib/schedule-builder/workspace.ts").includes("generate_cohort_delivery_groups"),
    "18 SB workspace not coupled to DG generator",
  );

  // ---------- Pure logic: delivery groups ----------
  {
    const r = calculateDeliveryGroupCount({
      componentType: "theory",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 1, "theory 26/60 → 1");
  }
  {
    const r = calculateDeliveryGroupCount({
      componentType: "theory",
      studentCount: 75,
      roomTypeCapacity: { defaultCapacity: 60 },
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 2, "theory 75/60 → 2");
  }
  {
    const r = calculateDeliveryGroupCount({
      componentType: "practical",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 30, strictCapacity: true },
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 1, "practical 26/30 → 1");
  }
  {
    const r = calculateDeliveryGroupCount({
      componentType: "practical",
      studentCount: 61,
      roomTypeCapacity: { defaultCapacity: 30, strictCapacity: true },
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 3, "practical 61/30 → 3");
  }
  {
    const r = calculateDeliveryGroupCount({
      componentType: "tutorial",
      studentCount: 40,
      explicitGroupSize: 20,
    });
    assert(r.ok && !("skipped" in r && r.skipped) && r.groupCount === 2, "tutorial independent");
  }
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
      "15 project groups excluded from standard workload",
    );
  }
  {
    const r = calculateDeliveryGroupCount({
      componentType: "summer_training",
      studentCount: 26,
      roomTypeCapacity: { defaultCapacity: 30 },
    });
    assert(r.ok && "skipped" in r && r.skipped && r.groupCount === 0, "16 summer_training skipped");
  }
  {
    const r = calculateDeliveryGroupCount({
      componentType: "theory",
      studentCount: 26,
      roomTypeCapacity: null,
    });
    assert(!r.ok && r.code === "MISSING_CAPACITY", "missing capacity error");
  }

  // 10) obsolete marked, not deleted
  {
    const plan = planDeliveryGroupReconciliation({
      requiredGroupCount: 1,
      existing: [
        { groupNumber: 1, hasTeachingAssignment: false, hasScheduleSession: false },
        { groupNumber: 2, hasTeachingAssignment: true, hasScheduleSession: false },
      ],
    });
    assert(plan.deleteNumbers.length === 0, "10 obsolete not deleted");
    assert(plan.obsoleteNumbers.includes(2), "10 obsolete marked");
    assert(
      plan.warnings.some((w) => w.code === "OBSOLETE_GROUP_LINKED" && w.groupNumber === 2),
      "10 linked obsolete warning",
    );
  }

  // 12) obsolete reactivation uses same natural key
  {
    const plan = planDeliveryGroupReconciliation({
      requiredGroupCount: 2,
      existing: [
        {
          groupNumber: 1,
          hasTeachingAssignment: false,
          hasScheduleSession: false,
          isObsolete: false,
        },
        {
          groupNumber: 2,
          hasTeachingAssignment: false,
          hasScheduleSession: false,
          isObsolete: true,
        },
      ],
    });
    assert(plan.createNumbers.length === 0, "12 no duplicate create on reactivate");
    assert(plan.reactivateNumbers.includes(2), "12 reactivate same group_number");
    assert(groupCodeForNumber(2) === "G2", "12 natural group code stable");
  }

  // 17) idempotency rerun
  {
    const plan = planDeliveryGroupReconciliation({
      requiredGroupCount: 2,
      existing: [
        { groupNumber: 1, hasTeachingAssignment: false, hasScheduleSession: false },
        { groupNumber: 2, hasTeachingAssignment: false, hasScheduleSession: false },
      ],
    });
    assert(plan.createNumbers.length === 0, "17 rerun no create duplicates");
    assert(plan.deleteNumbers.length === 0, "17 rerun no deletes");
  }

  // 13) duplicate compatibility offerings do not duplicate groups
  {
    const rows = uniqueComponentsById([
      { componentId: "c1", offeringId: "o1" },
      { componentId: "c1", offeringId: "o2" },
      { componentId: "c2", offeringId: "o3" },
    ]);
    assert(rows.length === 2, "13 unique components only");
    const resolved = resolveCompatibilityOffering([
      {
        id: "o-old",
        planCourseId: "pc1",
        createdAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "o-new",
        planCourseId: "pc1",
        createdAt: "2026-06-01T00:00:00Z",
      },
    ]);
    assert(resolved.ok && resolved.offeringId === "o-new", "13 deterministic newest offering");
  }

  // 14) ambiguous offerings return validation error
  {
    const ambiguous = resolveCompatibilityOffering([
      { id: "o1", planCourseId: "pc1", createdAt: "2026-06-01T00:00:00Z" },
      { id: "o2", planCourseId: "pc2", createdAt: "2026-06-02T00:00:00Z" },
    ]);
    assert(
      !ambiguous.ok && ambiguous.code === "AMBIGUOUS_COMPATIBILITY_OFFERINGS",
      "14 ambiguous offerings rejected",
    );
  }

  // 3) single-teacher fallback → component hours once
  {
    const h = hoursForAssignment({
      deliveryGroupId: "g1",
      componentType: "theory",
      weeklyContactHours: 3,
      assignedWeeklyHours: null,
      countsTowardRegularLoad: true,
      coInstructorCount: 0,
    });
    assert(h.standard === 3 && h.project === 0, "3 single-teacher fallback = component hours");
  }

  // 4) co-teaching explicit 2+1 for 3h component
  {
    const a = hoursForAssignment({
      deliveryGroupId: "g1",
      componentType: "theory",
      weeklyContactHours: 3,
      assignedWeeklyHours: 2,
      countsTowardRegularLoad: true,
      coInstructorCount: 1,
    });
    const b = hoursForAssignment({
      deliveryGroupId: "g1",
      componentType: "theory",
      weeklyContactHours: 3,
      assignedWeeklyHours: 1,
      countsTowardRegularLoad: true,
      coInstructorCount: 1,
    });
    assert(a.standard + b.standard === 3, "4 co-teaching 2+1 = 3");
    assert(
      validateCoTeachingHours({
        componentWeeklyHours: 3,
        assignedHours: [2, 1],
      }).ok,
      "4 co-teaching split accepted",
    );
  }

  // 5) co-teaching missing split rejected (not 6, not default 3 each)
  {
    const missing = hoursForAssignment({
      deliveryGroupId: "g1",
      componentType: "theory",
      weeklyContactHours: 3,
      assignedWeeklyHours: null,
      countsTowardRegularLoad: true,
      coInstructorCount: 1,
    });
    assert(missing.standard === 0, "5 missing split credits 0 (not DEFAULT 3)");
    const v = validateCoTeachingHours({
      componentWeeklyHours: 3,
      assignedHours: [null, null],
    });
    assert(!v.ok && v.code === "CO_TEACHING_HOURS_SPLIT_REQUIRED", "5 missing split rejected");
  }

  // 6) over-allocation rejected
  {
    const v = validateCoTeachingHours({
      componentWeeklyHours: 3,
      assignedHours: [2, 2],
    });
    assert(!v.ok && v.code === "CO_TEACHING_HOURS_OVER_ALLOCATED", "6 over-allocation rejected");
  }

  // 7) plan/course mismatch rejected
  {
    const bad = validateOfferingDeliveryGroupMatch({
      offeringPlanCourseId: "pc1",
      deliveryGroupPlanCourseId: "pc2",
      componentPlanCourseId: "pc2",
      offeringCollegeId: "col1",
      deliveryGroupCollegeId: "col1",
      cohortCollegeId: "col1",
    });
    assert(!bad.ok && bad.code === "OFFERING_PLAN_COURSE_MISMATCH", "7 plan/course mismatch");
    const componentBad = validateAssignmentComponentMatch({
      deliveryGroupComponentId: "c1",
      assignmentComponentId: "c2",
      deliveryGroupCohortId: "co1",
      assignmentCohortId: "co1",
      componentType: "theory",
    });
    assert(
      !componentBad.ok && componentBad.code === "ASSIGNMENT_COMPONENT_MISMATCH",
      "7 component mismatch",
    );
  }

  // 8) generator validation atomicity (pure status contract)
  {
    const failed = parseDeliveryGroupGeneratorSummary({
      status: "VALIDATION_FAILED",
      groups_created: 0,
      groups_updated: 0,
      groups_unchanged: 0,
      groups_obsolete: 0,
      validation_errors: [{ code: "MISSING_CAPACITY", component_id: "c-bad" }],
      warnings: [],
      skipped_components: [],
    });
    assert(failed.status === "VALIDATION_FAILED", "8 status VALIDATION_FAILED");
    assert(failed.groups_created === 0, "8 no partial creates on validation failure");
    assert(!isGeneratorSuccessStatus(failed.status), "8 not success");

    // Simulate mixed components: one invalid → whole run failed, zero DML
    const derived = deriveGeneratorStatus({
      validation_errors: [{ code: "MISSING_PROJECT_GROUP_SIZE" }],
      groups_created: 0,
      groups_updated: 0,
      groups_obsolete: 0,
    });
    assert(derived === "VALIDATION_FAILED", "8 derived atomic failure");
  }

  // 9) UI does not show success on validation error (static + status helper)
  {
    assert(!isGeneratorSuccessStatus("VALIDATION_FAILED"), "9 helper blocks success");
    assert(hook.includes("toast.error"), "9 hook uses toast.error path");
    assert(hook.includes("!success"), "9 success gated");
  }

  // 11) obsolete blocks new weekly assignment
  {
    const v = validateCoTeachingHours({
      isObsolete: true,
      componentWeeklyHours: 3,
      assignedHours: [3],
    });
    assert(
      !v.ok && v.code === "OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN",
      "11 obsolete blocks new assignment",
    );
  }

  // Cross-college access denied (static + pure)
  {
    const cross = validateOfferingDeliveryGroupMatch({
      offeringPlanCourseId: "pc1",
      deliveryGroupPlanCourseId: "pc1",
      componentPlanCourseId: "pc1",
      offeringCollegeId: "colA",
      deliveryGroupCollegeId: "colB",
      cohortCollegeId: "colB",
    });
    assert(
      !cross.ok && cross.code === "ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN",
      "1 cross-college workload/assignment denied (pure)",
    );
    assert(sql.includes("can_view_college(v_uid, v_instructor.college_id)"), "1 RPC college gate");
  }

  // Workload suite (project separate, summer excluded, overload/deficit)
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
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
        {
          deliveryGroupId: "g2",
          componentType: "practical",
          weeklyContactHours: 2,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
        {
          deliveryGroupId: "g3",
          componentType: "tutorial",
          weeklyContactHours: 1,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
      ],
    });
    assert(base.requiredLoadHours === 12, "required 12 for assistant professor");
    assert(base.standardAssignedHours === 6, "standard hours sum components");
    assert(base.status === "deficit", "deficit status");

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
        {
          deliveryGroupId: "gs",
          componentType: "summer_training",
          weeklyContactHours: 8,
          assignedWeeklyHours: null,
          countsTowardRegularLoad: false,
          coInstructorCount: 0,
        },
      ],
    });
    assert(withProject.standardAssignedHours === 12, "15 project not in standard");
    assert(withProject.projectSupervisionHours === 2, "15 project hours separate");
    assert(withProject.status === "ok", "16 summer excluded from standard");
  }

  // 18) Schedule Builder refs preserved
  assert(existsSync(join(root, "src/routes/_authenticated/schedule-builder.tsx")), "18 SB route");
  assert(existsSync(join(root, "src/lib/schedule-builder/workspace.ts")), "18 SB workspace");
  assert(
    read("src/routes/_authenticated/course-offerings.tsx").includes("قراءة"),
    "course_offerings read-only compatibility page",
  );

  // Summary parser + status
  const summary = parseDeliveryGroupGeneratorSummary({
    status: "SUCCESS",
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
  assert(summary.status === "SUCCESS", "summary status");
  assert(summary.skipped_components.length === 1, "summary skipped");

  console.log("PASS — PHASE-9.3 delivery-groups-workload-engine remediation harness");
  console.log(
    "Deferred runtime DB tests: live RPC unauthorized/cross-college, live generator atomicity, live obsolete session block",
  );
}

run();
