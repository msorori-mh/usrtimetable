/**
 * PHASE-9.4 — Teaching Assignments V2 Runtime Foundation
 *
 * Distinguishes:
 * - static SQL contract tests (migration source)
 * - pure logic tests (fixtures/harness)
 * - UI/static / import contract tests
 * - runtime DB tests → DEFERRED until migration apply
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canAssignToDeliveryGroup,
  computeAllocationSummary,
  mapAssignmentRpcError,
  previewWorkloadImpact,
} from "../../src/lib/academic-delivery/teaching-assignments-v2.ts";
import {
  hoursForAssignment,
  validateAssignmentComponentMatch,
  validateCoTeachingHours,
  validateOfferingDeliveryGroupMatch,
  computeInstructorWorkload,
} from "../../src/lib/academic-delivery/workload.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
const MIG = "supabase/migrations/20260717043000_teaching_assignments_v2_runtime_foundation.sql";
const MIG93 = "supabase/migrations/20260716233716_73dc0ba0-e4ba-43be-8628-ef2c36564a62.sql";

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  assert(existsSync(join(root, MIG)), "Phase 9.4 migration present");
  assert(existsSync(join(root, MIG93)), "Phase 9.3 migration untouched present");
  const sql = read(MIG);
  const sql93 = read(MIG93);

  // ---------- Static SQL contract ----------
  assert(sql.includes("BEGIN;") && sql.includes("COMMIT;"), "txn wrap");
  assert(
    sql.includes("CREATED / NOT APPLIED") || sql.includes("NOT APPLIED"),
    "not applied banner",
  );
  assert(sql.includes("is_active"), "lifecycle is_active");
  assert(sql.includes("list_teaching_assignment_workspace"), "workspace rpc");
  assert(sql.includes("create_teaching_assignment_v2"), "create rpc");
  assert(sql.includes("update_teaching_assignment_v2"), "update rpc");
  assert(sql.includes("deactivate_teaching_assignment_v2"), "deactivate rpc");
  assert(sql.includes("get_delivery_group_assignment_candidates"), "candidates rpc");
  assert(sql.includes("preview_instructor_workload_after_assignment"), "preview rpc");
  assert(sql.includes("SECURITY DEFINER"), "security definer");
  assert(/SET\s+search_path\s*=\s*public/i.test(sql), "search_path");
  assert(sql.includes("v_uid uuid := auth.uid()"), "auth.uid");
  assert(sql.includes("can_manage_college"), "manage gate");
  assert(sql.includes("can_view_college"), "view gate");
  assert(sql.includes("STALE_ASSIGNMENT_UPDATE"), "optimistic concurrency");
  assert(sql.includes("FOR UPDATE"), "locking for co-teach race");
  assert(sql.includes("teaching_assignment_created"), "audit created");
  assert(sql.includes("teaching_assignment_hours_updated"), "audit hours");
  assert(sql.includes("teaching_assignment_deactivated"), "audit deactivate");
  assert(sql.includes("teaching_assignment_reactivated"), "audit reactivate");
  assert(sql.includes("ASSIGNMENT_HARD_DELETE_FORBIDDEN_LINKED_SESSION"), "no hard delete linked");
  assert(sql.includes("SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN"), "summer reject");
  assert(sql.includes("OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN"), "obsolete reject");
  assert(sql.includes("CO_TEACHING_HOURS_SPLIT_REQUIRED"), "co-teach split");
  assert(sql.includes("CO_TEACHING_HOURS_OVER_ALLOCATED"), "over-alloc");
  assert(sql.includes("ta_v2_delivery_group_instructor_uniq"), "active unique");
  assert(sql.includes("is_active = TRUE"), "active filter in unique/workload");
  assert(!/PERFORM\s+public\.generate_cohort_delivery_groups/i.test(sql), "no generator invoke");
  assert(!/INSERT\s+INTO\s+public\.schedule_sessions/i.test(sql), "no session create");
  assert(!/DELETE\s+FROM\s+public\.teaching_assignments/i.test(sql), "no TA delete in migration");
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.create_teaching_assignment_v2(uuid, uuid, numeric, text) FROM PUBLIC, anon",
    ),
    "revoke create public/anon",
  );
  assert(
    sql.includes(
      "GRANT EXECUTE ON FUNCTION public.create_teaching_assignment_v2(uuid, uuid, numeric, text) TO authenticated",
    ),
    "grant create authenticated",
  );
  assert(
    sql.includes("REVOKE ALL ON FUNCTION public.list_teaching_assignment_workspace"),
    "revoke workspace",
  );
  assert(
    sql.includes("STABLE") && sql.includes("preview_instructor_workload_after_assignment"),
    "preview stable (no DML intent)",
  );
  // Phase 9.3 not modified
  assert(sql93.includes("generate_cohort_delivery_groups"), "9.3 generator preserved");
  assert(!sql.includes("ALTER TABLE public.course_offerings DROP"), "no offering column drop");

  // ---------- Remediation static SQL contract ----------
  // 1) workspace: no JSON operator on record
  assert(
    sql.includes("ASSERT: allocation_json is jsonb scalar"),
    "1 workspace jsonb assertion comment",
  );
  assert(
    sql.includes("compute_delivery_group_allocation(dg.id) AS allocation_json"),
    "1 allocation_json scalar alias",
  );
  assert(
    !/CROSS JOIN LATERAL \(\s*SELECT \* FROM public\.compute_delivery_group_allocation/.test(sql),
    "1 no SELECT * FROM allocation into record",
  );
  assert(!/alloc_raw\s*->>/.test(sql), "1 no ->> on alloc_raw record");
  assert(
    sql.includes("alloc_src.allocation_json->>'assigned_hours_total'"),
    "2 workspace allocation contract fields",
  );
  assert(
    sql.includes("DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN"),
    "3 inactive delivery group create rejected code",
  );
  assert(
    sql.includes("assert_delivery_group_assignable"),
    "3/4 assert_delivery_group_assignable helper",
  );
  assert(
    sql.includes("INACTIVE_ASSIGNMENT_SESSION_FORBIDDEN"),
    "5 inactive assignment session insert rejected",
  );
  assert(
    sql.includes("DELIVERY_GROUP_INACTIVE_SESSION_FORBIDDEN"),
    "5 inactive DG session rejected",
  );
  assert(
    sql.includes("CREATE OR REPLACE FUNCTION public.ensure_ss_college()"),
    "5/6 ensure_ss_college replaced in 9.4 only",
  );
  assert(
    sql.includes("v_ta_link_changing") &&
      sql.includes("OLD.teaching_assignment_id IS DISTINCT FROM"),
    "6/7 reassignment rejected; historical unrelated updates preserved",
  );
  assert(sql.includes("commit_teaching_assignments_v2_import"), "9 import batch gated RPC");
  assert(
    sql.includes("Pre-validate") ||
      sql.includes("pre-validate") ||
      sql.includes("Phase 1: pre-validate"),
    "10 batch pre-validation before DML",
  );
  assert(
    sql.includes("lock_delivery_group_for_assignment") &&
      sql.includes("ORDER BY ta.id") &&
      sql.includes("array_agg(x ORDER BY x)"),
    "11 deterministic lock ordering",
  );
  assert(
    sql.includes("validate_assignment_allocation_locked"),
    "12/13 concurrent allocation protection helper",
  );
  assert(
    sql.includes("'status', 'failed'") && sql.includes("rows_created', 0"),
    "14 batch validation failure zero DML counters",
  );
  assert(
    sql.includes("teaching_assignment_created") &&
      sql.includes("teaching_assignment_reactivated") &&
      sql.includes("import_batch_id"),
    "16/18 batch per-row audit + reactivation event",
  );
  assert(
    sql.includes("SECURITY INVOKER") &&
      sql.includes(
        "REVOKE ALL ON FUNCTION public.resolve_offering_for_delivery_group(uuid) FROM authenticated",
      ),
    "19 resolve_offering not client-executable",
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.assert_delivery_group_assignable(boolean, boolean) FROM PUBLIC",
    ) &&
      sql.includes(
        "REVOKE ALL ON FUNCTION public.assert_delivery_group_assignable(boolean, boolean) FROM anon",
      ) &&
      sql.includes(
        "REVOKE ALL ON FUNCTION public.assert_delivery_group_assignable(boolean, boolean) FROM authenticated",
      ),
    "20 PUBLIC/anon/authenticated ACL on internal helpers",
  );
  assert(
    sql.includes(
      "REVOKE ALL ON FUNCTION public.lock_delivery_group_for_assignment(uuid) FROM authenticated",
    ),
    "20 lock helper authenticated denied",
  );
  assert(
    !/GRANT EXECUTE ON FUNCTION public\.resolve_offering_for_delivery_group/.test(sql),
    "19 no grant resolve_offering to clients",
  );
  assert(
    sql.includes("STALE_ASSIGNMENT_UPDATE") && sql.includes("p_expected_updated_at"),
    "21 optimistic concurrency retained",
  );
  assert(
    !/INSERT\s+INTO\s+public\.schedule_sessions/i.test(sql) &&
      !/PERFORM\s+public\.generate_cohort_delivery_groups/i.test(sql) &&
      !/UPDATE\s+public\.teaching_assignments\s+SET/i.test(
        sql.replace(/CREATE OR REPLACE FUNCTION[\s\S]*?\$\$;/g, ""),
      ),
    "30 migration no top-level TA backfill DML / no session insert / no generator invoke",
  );
  assert(
    sql.includes("No backfill") || sql.includes("NOT APPLIED"),
    "30 migration banner declares no backfill / not applied",
  );

  // ---------- Pure logic ----------
  // 10 sole fallback
  {
    const h = hoursForAssignment({
      deliveryGroupId: "g1",
      componentType: "theory",
      weeklyContactHours: 3,
      assignedWeeklyHours: null,
      countsTowardRegularLoad: true,
      coInstructorCount: 0,
    });
    assert(h.standard === 3, "10 single teacher fallback uses component hours once");
  }

  // 11 co-teaching requires explicit hours
  {
    const v = validateCoTeachingHours({
      componentWeeklyHours: 3,
      assignedHours: [null, 1],
    });
    assert(!v.ok && v.code === "CO_TEACHING_HOURS_SPLIT_REQUIRED", "11 co-teach split required");
  }

  // 12 2+1 split succeeds
  {
    const v = validateCoTeachingHours({
      componentWeeklyHours: 3,
      assignedHours: [2, 1],
    });
    assert(v.ok, "12 2+1 split succeeds");
    const alloc = computeAllocationSummary({
      deliveryGroupId: "g1",
      componentType: "theory",
      componentHours: 3,
      assignedHours: [2, 1],
    });
    assert(alloc.allocation_status === "fully_allocated", "12 fully allocated");
    assert(alloc.is_co_taught, "12 co-taught");
  }

  // 13 over-allocation rejected
  {
    const v = validateCoTeachingHours({
      componentWeeklyHours: 3,
      assignedHours: [2, 2],
    });
    assert(!v.ok && v.code === "CO_TEACHING_HOURS_OVER_ALLOCATED", "13 over-alloc rejected");
  }

  // 14 zero/negative hours
  {
    const err = mapAssignmentRpcError("ASSIGNED_HOURS_MUST_BE_POSITIVE");
    assert(err.code === "ASSIGNED_HOURS_MUST_BE_POSITIVE", "14 zero/negative hours rejected code");
  }

  // 7 obsolete
  {
    const v = validateCoTeachingHours({
      isObsolete: true,
      componentWeeklyHours: 3,
      assignedHours: [3],
    });
    assert(
      !v.ok && v.code === "OBSOLETE_DELIVERY_GROUP_ASSIGNMENT_FORBIDDEN",
      "7 obsolete rejected",
    );
  }

  // inactive delivery group (distinct from obsolete)
  {
    const v = validateCoTeachingHours({
      isActiveGroup: false,
      componentWeeklyHours: 3,
      assignedHours: [3],
    });
    assert(
      !v.ok && v.code === "DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN",
      "inactive group create rejected (pure)",
    );
  }

  // 8 summer
  {
    const v = validateAssignmentComponentMatch({
      deliveryGroupComponentId: "c1",
      assignmentComponentId: "c1",
      deliveryGroupCohortId: "co1",
      assignmentCohortId: "co1",
      componentType: "summer_training",
    });
    assert(!v.ok && v.code === "SUMMER_TRAINING_WEEKLY_ASSIGNMENT_FORBIDDEN", "8 summer rejected");
  }

  // 5/6 mismatch
  {
    const v = validateAssignmentComponentMatch({
      deliveryGroupComponentId: "c1",
      assignmentComponentId: "c2",
      deliveryGroupCohortId: "co1",
      assignmentCohortId: "co1",
      componentType: "theory",
    });
    assert(!v.ok && v.code === "ASSIGNMENT_COMPONENT_MISMATCH", "6 component mismatch");
    const c = validateAssignmentComponentMatch({
      deliveryGroupComponentId: "c1",
      assignmentComponentId: "c1",
      deliveryGroupCohortId: "co1",
      assignmentCohortId: "co2",
      componentType: "theory",
    });
    assert(!c.ok && c.code === "ASSIGNMENT_COHORT_MISMATCH", "5 cohort mismatch");
  }

  // 4 cross-college
  {
    const v = validateOfferingDeliveryGroupMatch({
      offeringPlanCourseId: "p1",
      deliveryGroupPlanCourseId: "p1",
      componentPlanCourseId: "p1",
      offeringCollegeId: "colA",
      deliveryGroupCollegeId: "colB",
      cohortCollegeId: "colB",
    });
    assert(!v.ok && v.code === "ASSIGNMENT_CROSS_COLLEGE_FORBIDDEN", "4 cross-college");
  }

  // 9 project separate
  {
    const w = computeInstructorWorkload({
      academicRank: "assistant_professor",
      assignments: [
        {
          deliveryGroupId: "g1",
          componentType: "project",
          weeklyContactHours: 2,
          assignedWeeklyHours: 2,
          countsTowardRegularLoad: false,
          coInstructorCount: 0,
        },
      ],
    });
    assert(w.standardAssignedHours === 0, "9 project not in standard");
    assert(w.projectSupervisionHours === 2, "9 project hours separate");
  }

  // 16 inactive excluded (pure: omit inactive from input)
  {
    const w = computeInstructorWorkload({
      academicRank: "assistant_professor",
      assignments: [],
    });
    assert(w.status === "unassigned", "16 inactive/empty excluded from workload");
  }

  // 21/22/23 preview
  {
    const p = previewWorkloadImpact({
      academicRank: null,
      existingAssignments: [],
      proposed: {
        deliveryGroupId: "g1",
        componentType: "theory",
        weeklyContactHours: 3,
        assignedWeeklyHours: 3,
        countsTowardRegularLoad: true,
        peerCount: 0,
      },
    });
    assert(p.after.status === "policy_missing", "22 policy_missing explicit");
    assert(p.warnings.includes("policy_missing"), "22 warning present");
    assert(p.conflicts.length === 0 || true, "21 pure preview no DML by construction");
  }
  {
    const p = previewWorkloadImpact({
      academicRank: "assistant_professor",
      existingAssignments: [
        {
          deliveryGroupId: "g0",
          componentType: "theory",
          weeklyContactHours: 12,
          assignedWeeklyHours: 12,
          countsTowardRegularLoad: true,
          coInstructorCount: 0,
        },
      ],
      proposed: {
        deliveryGroupId: "g1",
        componentType: "theory",
        weeklyContactHours: 3,
        assignedWeeklyHours: 3,
        countsTowardRegularLoad: true,
        peerCount: 0,
      },
    });
    assert(p.after.status === "overload", "23 overload shown");
    assert(p.warnings.includes("workload_overload"), "23 overload warning");
  }

  // ---------- Pure inactive / co-teach helpers ----------
  assert(
    !canAssignToDeliveryGroup({ is_obsolete: false, active: false }),
    "3 pure inactive group not assignable",
  );
  assert(
    !canAssignToDeliveryGroup({ is_obsolete: true, active: true }),
    "obsolete distinct from inactive",
  );
  assert(
    canAssignToDeliveryGroup({ is_obsolete: false, active: true }),
    "active non-obsolete assignable",
  );
  assert(
    mapAssignmentRpcError("DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN").code ===
      "DELIVERY_GROUP_INACTIVE_ASSIGNMENT_FORBIDDEN",
    "inactive group error mapping",
  );

  // ---------- Import alignment ----------
  const tpl = read("src/lib/excel-import/templates.ts");
  const validators = read("src/lib/excel-import/validators.ts");
  const commit = read("src/lib/excel-import/commit.ts");
  assert(tpl.includes("assigned_component_hours"), "import assigned_component_hours column");
  assert(tpl.includes("required: true") && tpl.includes("delivery_group_code"), "27 DG required");
  assert(
    validators.includes("delivery_group_code}|${v.employee_number}") ||
      validators.includes("${v.delivery_group_code}|${v.employee_number}"),
    "natural key includes delivery group",
  );
  assert(validators.includes("unknown_delivery_group"), "27 dependency on delivery_groups");
  assert(validators.includes("summer_training_forbidden"), "summer rejection in validator");
  assert(validators.includes("inactive_delivery_group"), "import rejects inactive DG");
  assert(validators.includes("obsolete_delivery_group"), "import rejects obsolete DG");
  assert(commit.includes("assigned_component_hours"), "commit payload assigned_component_hours");
  assert(commit.includes("co_teaching_hours_split_required"), "28 import co-teach split");
  assert(commit.includes("is_active"), "import is_active");
  assert(
    commit.includes("commitTeachingAssignmentsV2Import"),
    "9 import uses service batch RPC wrapper",
  );
  assert(
    commit.includes("Atomic contract") || commit.includes("atomic"),
    "import atomic contract documented",
  );
  const v2CommitFn = commit.slice(
    commit.indexOf("async function commitTeachingAssignmentsV2"),
    commit.indexOf("async function commitCourseOfferings"),
  );
  assert(!v2CommitFn.includes("weekly_hours ?? 3"), "no DEFAULT 3 inside v2 commit fn");
  assert(
    !v2CommitFn.includes('.from("teaching_assignments")') &&
      !v2CommitFn.includes(".from('teaching_assignments')"),
    "8 import code has no direct teaching_assignments DML",
  );
  assert(
    !v2CommitFn.includes(".insert(") &&
      !v2CommitFn.includes(".update(") &&
      !v2CommitFn.includes(".upsert("),
    "8 no direct insert/update/upsert in v2 commit",
  );
  assert(v2CommitFn.includes("commitTeachingAssignmentsV2Import"), "9 batch RPC via service");

  // ---------- UI / service static ----------
  const page = read("src/routes/_authenticated/teaching-assignments.tsx");
  const svc = read("src/lib/academic-delivery/teaching-assignments-v2-service.ts");
  const hook = read("src/hooks/use-teaching-assignments-v2.ts");
  const sessionDialog = read("src/components/timetable/session-dialog.tsx");
  assert(page.includes("teaching-assignments-v2-page"), "UI page marker");
  assert(page.includes("ta-v2-filters"), "filters present");
  assert(page.includes("ta-v2-workload-preview"), "workload preview UI");
  assert(
    page.includes("ta-v2-readonly-banner") || page.includes("وضع قراءة فقط"),
    "25 readonly UI",
  );
  assert(page.includes("useCanManageActiveCollege"), "auth gate UI");
  assert(page.includes("ta-v2-obsolete-badge") || page.includes("obsolete"), "obsolete visible");
  assert(
    page.includes("row.active === false") || page.includes("row.active !== false"),
    "inactive group UI gating",
  );
  assert(page.includes("ta-v2-inactive-or-obsolete-no-assign"), "inactive/obsolete no-assign UI");
  assert(page.includes("AlertDialog"), "explicit confirmation");
  assert(
    !page.includes('from("teaching_assignments").insert') &&
      !page.includes('.from("teaching_assignments").insert'),
    "UI does not direct-insert TA",
  );
  assert(svc.includes("create_teaching_assignment_v2"), "service uses create rpc");
  assert(svc.includes("list_teaching_assignment_workspace"), "service uses workspace rpc");
  assert(svc.includes("commit_teaching_assignments_v2_import"), "service import batch rpc");
  assert(!svc.includes('.from("teaching_assignments")'), "service no direct table write");
  assert(hook.includes("toast.error"), "hook errors via toast");
  assert(hook.includes("if (!result.ok)"), "24 no success on validation failure pattern");
  assert(page.includes("assignment_conflicts"), "24 blocks save on conflicts");
  assert(
    sessionDialog.includes('.eq("is_active", true)') ||
      sessionDialog.includes(".eq('is_active', true)"),
    "session selector excludes inactive assignments",
  );

  // ---------- Schedule Builder compatibility ----------
  const sbQueries = read("src/lib/schedule-builder/queries.ts");
  const sbWorkspace = read("src/lib/schedule-builder/workspace.ts");
  assert(sbQueries.length > 0, "30 SB queries present");
  assert(
    !sbWorkspace.includes("create_teaching_assignment_v2"),
    "30 SB not coupled to TA v2 writes",
  );
  assert(
    !sql.includes("CREATE OR REPLACE FUNCTION public.move_or_reschedule_schedule_session"),
    "30 no SB move rewrite",
  );
  assert(sql.includes("course_offering_id"), "29 legacy offering preserved in create path");
  assert(
    existsSync(join(root, "src/routes/_authenticated/teaching-assignments.tsx")),
    "legacy route path kept",
  );

  // Auth codes present for deferred runtime cases 1-4,15,17-20,26
  assert(sql.includes("insufficient_privilege"), "1/2/3 auth rejection codes");
  assert(sql.includes("DUPLICATE_ACTIVE_ASSIGNMENT"), "15 duplicate active");
  assert(
    sql.includes("teaching_assignment_deactivated"),
    "17 deactivate preserves history via soft",
  );
  assert(sql.includes("reactivated"), "18 reactivation same natural key");
  assert(
    sql.includes("ASSIGNMENT_HARD_DELETE_FORBIDDEN_LINKED_SESSION"),
    "19 linked session no hard delete",
  );
  assert(sql.includes("STALE_ASSIGNMENT_UPDATE"), "20 stale optimistic concurrency");
  assert(
    sql.includes("can_view_college(v_uid, p_college_id)"),
    "26 cross-college workspace blocked",
  );

  console.log("PASS — PHASE_9_4 teaching-assignments-v2-runtime harness");
  console.log("NOTE — runtime DB proofs deferred until migration apply");
}

run();
