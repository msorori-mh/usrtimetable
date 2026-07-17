/**
 * Phase 9.5 — assignment-driven Schedule Builder V2 contracts.
 * Source-only/pure checks: this harness performs no database or network writes.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildInactiveAssignmentWarning,
  computeSchedulingStatus,
  mapCreateSessionError,
  parseCreateSessionResult,
  parseWorkItem,
  parseWorkItemsPayload,
  wallClockHours,
} from "../../src/lib/schedule-builder/v2-assignment-integration.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const paths = {
  contract: "src/lib/schedule-builder/v2-assignment-integration.ts",
  service: "src/lib/schedule-builder/v2-assignment-service.ts",
  ui: "src/components/schedule-builder/v2-add-session-dialog.tsx",
  panel: "src/components/schedule-builder/v2-work-items-panel.tsx",
  route: "src/routes/_authenticated/schedule-builder.tsx",
  migration: "supabase/migrations/20260717093000_schedule_builder_v2_assignment_integration.sql",
};

function read(relativePath: string): string {
  const absolutePath = join(root, relativePath);
  assert(existsSync(absolutePath), `missing Phase 9.5 source: ${relativePath}`);
  return readFileSync(absolutePath, "utf8");
}

function runPureContracts() {
  assert(wallClockHours("08:00", "10:30") === 2.5, "wall-clock duration");
  assert(wallClockHours("08:15:00", "09:45:00") === 1.5, "seconds accepted");
  assert(wallClockHours("10:00", "08:00") === 0, "reversed range rejected");
  assert(wallClockHours("bad", "09:00") === 0, "invalid time rejected");

  assert(computeSchedulingStatus({ assigned: 3, scheduled: 0 }) === "unscheduled", "unscheduled");
  assert(
    computeSchedulingStatus({ assigned: 3, scheduled: 1.5 }) === "partially_scheduled",
    "partial",
  );
  assert(computeSchedulingStatus({ assigned: 3, scheduled: 3 }) === "scheduled", "scheduled");
  assert(computeSchedulingStatus({ assigned: 3, scheduled: 3.1 }) === "over_scheduled", "over");
  assert(
    computeSchedulingStatus({ assigned: 3, scheduled: 0, blockedReason: "inactive" }) === "blocked",
    "blocked wins",
  );

  assert(mapCreateSessionError("STALE_VERSION").length > 0, "known error localized");
  assert(
    mapCreateSessionError("FUTURE_CODE", "server detail") === "server detail",
    "server fallback retained",
  );

  assert(parseWorkItem(null) === null, "invalid work item ignored");
  assert(parseWorkItem({ course_code: "X" }) === null, "assignment identity required");
  const item = parseWorkItem({
    teaching_assignment_id: "ta-1",
    assigned_component_hours: "3",
    currently_scheduled_hours: "1.5",
    remaining_schedule_hours: "-4",
    scheduling_status: "unexpected",
    assignment_active: false,
  });
  assert(item?.assigned_component_hours === 3, "numeric assignment hours parsed");
  assert(item?.remaining_schedule_hours === 0, "remaining hours never negative");
  assert(item?.scheduling_status === "blocked", "unknown status fails closed");
  assert(item?.assignment_active === false, "inactive assignment preserved");

  const payload = parseWorkItemsPayload({
    ok: true,
    schedule_version_id: "version-1",
    can_manage: true,
    rows: [{ teaching_assignment_id: "ta-1" }, { invalid: true }],
  });
  assert(payload.rows.length === 1, "malformed rows filtered");
  assert(payload.can_manage, "manage capability parsed");

  const result = parseCreateSessionResult({
    ok: false,
    code: "BLOCKED_CONFLICTS",
    stale: true,
    blocking_conflicts: [{ code: "room_overlap", severity: "hard" }],
    scheduling_summary: { assigned_component_hours: "2", remaining_schedule_hours: "-1" },
  });
  assert(!result.ok && result.stale, "failure/stale parsed");
  assert(result.blocking_conflicts[0]?.code === "room_overlap", "conflict parsed");
  assert(result.scheduling_summary?.remaining_schedule_hours === 0, "summary remaining clamped");

  const warningBase = {
    teaching_assignment_id: "ta-1",
    delivery_group_id: "dg-1",
    cohort_id: "cohort-1",
    plan_course_component_id: "component-1",
    assignment_active: true,
    delivery_group_active: true,
    delivery_group_obsolete: false,
    component_type: "theory",
    assigned_component_hours: 2,
    currently_scheduled_hours: 1,
    remaining_schedule_hours: 1,
    inactive_assignment_warning: false,
  };
  assert(
    buildInactiveAssignmentWarning({ ...warningBase, assignment_active: false }),
    "inactive assignment warning",
  );
  assert(
    buildInactiveAssignmentWarning({ ...warningBase, delivery_group_obsolete: true }),
    "obsolete group warning",
  );
  assert(
    buildInactiveAssignmentWarning(warningBase) === null,
    "active relationship has no warning",
  );
}

function runStaticContracts() {
  const contract = read(paths.contract);
  const service = read(paths.service);
  const ui = read(paths.ui);
  const panel = read(paths.panel);
  const route = read(paths.route);
  const sql = read(paths.migration);

  assert(sql.includes("BEGIN;") && sql.trimEnd().endsWith("COMMIT;"), "migration is transactional");
  assert(
    sql.includes("NO backfill. NO generator invocation. NO operational session inserts."),
    "source-only intent documented",
  );
  assert(sql.includes("list_schedule_builder_v2_work_items"), "work-item read RPC exists");
  assert(sql.includes("create_schedule_session_from_assignment_v2"), "create RPC exists");
  assert(
    sql.includes("SECURITY DEFINER") && sql.includes("SET search_path = public"),
    "definer functions pin search path",
  );
  assert(
    sql.includes("public.can_view_college") && sql.includes("public.can_manage_college"),
    "college authorization gates",
  );
  assert(sql.includes("FOR UPDATE"), "race-sensitive records locked");
  assert(
    sql.includes("p_expected_version_updated_at") && sql.includes("STALE_VERSION"),
    "optimistic version gate",
  );
  assert(
    sql.includes("VERSION_PUBLISHED") && sql.includes("VERSION_ARCHIVED"),
    "non-draft versions blocked",
  );
  assert(
    sql.includes("CROSS_TERM_FORBIDDEN") &&
      sql.includes("v_offering_term_id IS DISTINCT FROM v_version.academic_term_id") &&
      sql.includes("v_cohort_term_id IS DISTINCT FROM v_version.academic_term_id"),
    "assignment offering and cohort must match the schedule term",
  );
  assert(
    sql.includes("INACTIVE_ASSIGNMENT") && sql.includes("OBSOLETE_DELIVERY_GROUP"),
    "inactive relationships blocked",
  );
  assert(
    sql.includes("SUMMER_TRAINING_BLOCKED") && sql.includes("PROJECT_NON_WEEKLY"),
    "non-weekly components blocked",
  );
  assert(sql.includes("OVER_SCHEDULED"), "assigned-hour ceiling enforced");
  assert(sql.includes("_collect_schedule_session_move_conflicts"), "canonical conflicts reused");
  assert(sql.includes("_sb_v2_delivery_group_overlap"), "delivery-group conflicts enforced");
  assert(
    sql.includes("p_cohort_id IS NOT NULL AND ss.cohort_id = p_cohort_id"),
    "cohort overlap is independent of delivery-group identity",
  );
  for (const predicate of [
    "dg.college_id = ta.college_id",
    "pcc.college_id = ta.college_id",
    "pc.college_id = ta.college_id",
    "c.college_id = ta.college_id",
    "i.college_id = ta.college_id",
  ]) {
    assert(sql.includes(predicate), `definer read join is tenant-scoped: ${predicate}`);
  }
  assert(sql.includes("INSERT INTO public.audit_logs"), "successful writes audited");
  assert(
    !/\b(?:TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE\s+[^;]+DISABLE\s+ROW\s+LEVEL\s+SECURITY)\b/i.test(
      sql,
    ),
    "no destructive/RLS bypass DDL",
  );

  assert(
    service.includes('.rpc("list_schedule_builder_v2_work_items"'),
    "service lists through RPC",
  );
  assert(
    service.includes('.rpc("create_schedule_session_from_assignment_v2"'),
    "service creates through RPC",
  );
  assert(
    !/\.from\(["'](?:schedule_sessions|teaching_assignments)["']\)/.test(service),
    "service has no direct table DML path",
  );
  assert(service.includes("p_expected_version_updated_at"), "service sends concurrency token");
  assert(service.includes("p_teaching_assignment_id"), "service sends assignment identity");

  assert(
    ui.includes("createScheduleSessionFromAssignmentV2"),
    "dialog invokes assignment RPC service",
  );
  assert(
    ui.includes("workItem.teaching_assignment_id"),
    "dialog preserves selected assignment identity",
  );
  assert(ui.includes("expectedVersionUpdatedAt"), "dialog carries version token");
  assert(
    ui.includes("proposedHours > workItem.remaining_schedule_hours"),
    "dialog previews over-schedule",
  );
  assert(
    ui.includes("!workItem.can_create_session || submitting || wouldOver"),
    "over-schedule disabled in UI",
  );
  assert(ui.includes("result.blocking_conflicts.map"), "blocking conflicts rendered");
  assert(panel.includes("التكليفات غير المجدولة"), "work-item panel has required identity");
  assert(panel.includes("listScheduleBuilderV2WorkItems"), "panel loads assignment work items");
  assert(
    panel.includes("payload?.version_updated_at"),
    "panel refreshes concurrency token from RPC",
  );
  assert(
    panel.includes("!mayCreate || !item.can_create_session"),
    "read-only and blocked rows cannot create",
  );
  assert(route.includes("<V2WorkItemsPanel"), "schedule-builder route wires the work-item panel");
  assert(
    contract.includes("No Supabase client calls here"),
    "pure contract module stays client-free",
  );
}

runPureContracts();
runStaticContracts();
console.log("phase-9-5-assignment-integration.harness.ts: PASS");
