/**
 * Schedule Builder conflict-save integration harness.
 * Source/contract guards + pure helpers. No DB apply, no network writes.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canSaveAfterValidation } from "../../src/lib/schedule-builder/session-move-rpc";
import type { ValidateSessionMoveResult } from "../../src/lib/schedule-builder/session-move-rpc";
import { canEnterEditMode } from "../../src/lib/schedule-builder/edit-access";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  const migrationRel = "supabase/migrations/20260714010000_schedule_session_move_rpc.sql";
  assert(existsSync(join(root, migrationRel)), "migration file exists");
  const migration = readSrc(migrationRel);
  const page = readSrc("src/routes/_authenticated/schedule-builder.tsx");
  const sheet = readSrc("src/components/schedule-builder/session-edit-sheet.tsx");
  const rpcClient = readSrc("src/lib/schedule-builder/session-move-rpc.ts");
  const types = readSrc("src/integrations/supabase/types.ts");

  // RPC contract present
  assert(migration.includes("validate_schedule_session_move"), "validate RPC in migration");
  assert(migration.includes("move_or_reschedule_schedule_session"), "save RPC in migration");
  assert(migration.includes("SECURITY DEFINER"), "SECURITY DEFINER");
  assert(migration.includes("SET search_path = public"), "search_path fixed");
  assert(migration.includes("FOR UPDATE"), "row lock");
  assert(migration.includes("STALE_SESSION"), "stale code");
  assert(migration.includes("can_manage_college"), "college manage gate");
  assert(migration.includes("'published'") && migration.includes("'archived'"), "version lock");
  assert(migration.includes("audit_logs"), "audit insert");
  assert(migration.includes("REVOKE ALL"), "revoke public/anon");
  assert(migration.includes("GRANT EXECUTE"), "grant authenticated");
  assert(!migration.includes("OVERRIDE") && !migration.includes("bypass_conflicts"), "no override");

  // Conflict coverage in SQL collector
  for (const code of [
    "instructor_conflict",
    "room_conflict",
    "section_conflict",
    "room_capacity",
    "room_type_mismatch",
    "instructor_availability",
    "instructor_availability_required",
    "room_availability",
    "study_system_time_template",
    "daily_break",
    "outside_working_hours",
    "outside_working_days",
  ]) {
    assert(migration.includes(`'${code}'`), `conflict code ${code}`);
  }

  // Warnings block save currently
  assert(migration.includes("BLOCKED_WARNINGS"), "warnings block save");

  // Client uses RPCs only (no direct session update)
  assert(rpcClient.includes('rpc("validate_schedule_session_move"'), "client validate rpc");
  assert(rpcClient.includes('rpc("move_or_reschedule_schedule_session"'), "client save rpc");
  assert(!rpcClient.includes('.from("schedule_sessions").update'), "rpc client no direct update");
  assert(!page.includes('.from("schedule_sessions").update'), "page no direct update");
  assert(!sheet.includes('.from("schedule_sessions").update'), "sheet no direct update");
  assert(!page.includes(".insert("), "page no insert");
  assert(!sheet.includes("mutationFn"), "sheet no mutationFn");
  assert(!page.toLowerCase().includes("run_auto_schedule"), "no scheduler");
  assert(!page.includes("publishVersion"), "no publish");

  // UI wires
  assert(sheet.includes("فحص التعارضات"), "validate button");
  assert(sheet.includes("حفظ التغيير"), "save button");
  assert(sheet.includes("تعارضات مانعة"), "blocking list");
  assert(sheet.includes("تحذيرات"), "warnings list");
  assert(sheet.includes("استثناءات معتمدة") || sheet.includes("استثناء معتمد"), "exception badge");
  assert(page.includes("onValidateConflicts"), "page validate handler");
  assert(page.includes("onSaveChange"), "page save handler");
  assert(page.includes("invalidateQueries"), "reload after save");
  assert(
    page.includes("draggable={editModeActive && mayEnterEdit}"),
    "drag gated to edit mode (pending-only drop)",
  );
  assert(page.includes("onDropAt={onGridDrop}"), "drop wired to pending handler");
  assert(page.includes("onValidateConflicts"), "validate remains explicit");
  assert(page.includes("moveOrRescheduleScheduleSession"), "save still via RPC helper");

  // Instructor / create / delete not offered
  assert(!sheet.includes('htmlFor="edit-instructor"'), "no instructor edit");
  assert(!sheet.includes("إنشاء جلسة"), "no create");
  assert(!sheet.includes("حذف الجلسة"), "no delete");

  // Permission helpers still gate edit mode
  assert(
    canEnterEditMode({
      canManageRole: false,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "draft",
    }) === false,
    "read_only cannot enter edit",
  );
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "published",
    }) === false,
    "published blocked",
  );
  assert(
    canEnterEditMode({
      canManageRole: true,
      hasActiveCollege: true,
      versionId: "v1",
      versionStatus: "archived",
    }) === false,
    "archived blocked",
  );

  // Save gate helper
  const blocked: ValidateSessionMoveResult = {
    valid: false,
    blocking_conflicts: [{ code: "instructor_conflict" }],
    warnings: [],
    approved_exceptions: [],
    stale: false,
    normalized_proposal: null,
  };
  assert(canSaveAfterValidation(blocked) === false, "blocking prevents save");
  const warned: ValidateSessionMoveResult = {
    valid: true,
    blocking_conflicts: [],
    warnings: [{ code: "soft_gap" }],
    approved_exceptions: [],
    stale: false,
    normalized_proposal: null,
  };
  assert(canSaveAfterValidation(warned) === false, "warnings prevent save");
  const stale: ValidateSessionMoveResult = {
    valid: true,
    blocking_conflicts: [],
    warnings: [],
    approved_exceptions: [],
    stale: true,
    normalized_proposal: null,
  };
  assert(canSaveAfterValidation(stale) === false, "stale prevents save");
  const ok: ValidateSessionMoveResult = {
    valid: true,
    blocking_conflicts: [],
    warnings: [],
    approved_exceptions: [],
    stale: false,
    normalized_proposal: {
      day_of_week: 0,
      start_time: "08:00",
      end_time: "10:00",
      room_id: "r1",
    },
  };
  assert(canSaveAfterValidation(ok) === true, "clean validation allows save");
  assert(canSaveAfterValidation(null) === false, "null validation no save");

  // Types registered
  assert(types.includes("validate_schedule_session_move"), "types validate");
  assert(types.includes("move_or_reschedule_schedule_session"), "types save");

  // Failure keeps pending — page does not clear pending on error path before ok
  assert(page.includes("بقي التغيير المحلي"), "failure keeps pending messaging");
  assert(page.includes("setPending(null)") && page.includes("result.ok"), "success clears pending");

  // Validation RPC is dry-run (no UPDATE in validate function body before collector)
  const validateFn = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.validate_schedule_session_move"),
    migration.indexOf("CREATE OR REPLACE FUNCTION public.move_or_reschedule_schedule_session"),
  );
  assert(
    !validateFn.includes("UPDATE public.schedule_sessions"),
    "validate RPC does not write sessions",
  );
  assert(!validateFn.includes("INSERT INTO public.audit_logs"), "validate RPC no audit write");

  const saveFn = migration.slice(
    migration.indexOf("CREATE OR REPLACE FUNCTION public.move_or_reschedule_schedule_session"),
  );
  assert(saveFn.includes("UPDATE public.schedule_sessions"), "save RPC updates session");
  assert(saveFn.includes("INSERT INTO public.audit_logs"), "save RPC audits");
  assert(
    saveFn.includes("day_of_week = p_target_day_of_week") &&
      saveFn.includes("start_time = p_target_start_time") &&
      saveFn.includes("end_time = p_target_end_time") &&
      saveFn.includes("room_id = p_target_room_id"),
    "save updates only day/time/room",
  );
  assert(!saveFn.includes("instructor_id ="), "save does not change instructor");

  console.log("schedule-builder-conflict-save-integration harness: PASS");
}

run();
