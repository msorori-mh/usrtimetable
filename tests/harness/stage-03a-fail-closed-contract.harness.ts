import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

const readiness = read("src/lib/reports/readiness.ts");
for (const relation of [
  "courses",
  "plan_courses",
  "instructors",
  "rooms",
  "course_offerings",
  "teaching_assignments",
  "schedule_sessions",
  "room_types",
]) {
  assert.ok(
    readiness.includes(`["${relation}",`),
    `${relation} must be included in the fail-closed query result set`,
  );
}
assert.ok(
  readiness.includes("READINESS_QUERY_FAILED[${relation}]"),
  "base query failures preserve the failing relation and throw",
);
assert.ok(
  readiness.includes("NEW_FLOW_READINESS_QUERY_FAILED"),
  "PostgREST/New Flow relation errors must remain errors",
);
assert.match(
  readiness,
  /مقاييس التدفق الجديد[\s\S]*total:\s*1,[\s\S]*missing:\s*1,[\s\S]*critical:\s*true/,
  "missing New Flow dependency must be a critical blocker, never a zero-row success",
);
for (const dependency of ["SCHEDULING_HEADCOUNT_MISSING", "بدون مجموعات", "بدون إسناد تدريسي"]) {
  assert.ok(readiness.includes(dependency), `readiness dependency covered: ${dependency}`);
}

assert.ok(
  readiness.includes("...roomCapacityReadinessMetrics("),
  "room checks use shared resource metrics",
);
const roomReadiness = read("src/lib/reports/room-capacity-readiness.ts");
for (const label of ["قاعات بدون نوع قاعة", "قاعات بسعة ≤ 0"]) {
  assert.ok(roomReadiness.includes(label), `shared readiness dependency covered: ${label}`);
}

const route = read("src/routes/_authenticated/auto-schedule.tsx");
assert.ok(
  route.includes("const freshReadiness = await fetchCollegeReadiness"),
  "auto-schedule rechecks readiness at mutation time",
);
assert.ok(route.includes("READINESS_BLOCKED:"), "real blocker reason reaches the operator");
assert.ok(route.includes("readinessQueryError.message"), "query failure reason is visible");
assert.ok(route.includes("runV2AutoSchedule"), "auto-schedule route uses New Flow V2 scheduler");
assert.equal(
  route.includes("runGreedyAutoSchedule"),
  false,
  "auto-schedule route cannot invoke the Legacy scheduler",
);

const v2Scheduler = read("src/lib/auto-scheduler/v2.ts");
for (const identity of [
  "teaching_assignment_id",
  "delivery_group_id",
  "cohort_id",
  "study_system",
]) {
  assert.ok(v2Scheduler.includes(identity), `V2 scheduler identity: ${identity}`);
}
assert.ok(
  v2Scheduler.includes("createScheduleSessionFromAssignmentV2"),
  "V2 scheduler writes only through guarded session RPC service",
);
assert.ok(
  v2Scheduler.includes("V2_DESTRUCTIVE_MODE_BLOCKED"),
  "destructive modes fail closed until an atomic V2 reset RPC exists",
);
assert.equal(v2Scheduler.includes('.from("sections")'), false, "no Legacy sections dependency");
assert.equal(v2Scheduler.includes("section_id"), false, "no Legacy section identity");
assert.equal(v2Scheduler.includes('.from("course_offerings")'), false, "no Legacy offering query");

const scheduler = read("src/lib/auto-scheduler/greedy.ts");
for (const marker of [
  "AUTO_SCHEDULE_QUERY_FAILED[scheduling_settings]",
  "AUTO_SCHEDULE_QUERY_FAILED[time_slot_templates]",
  "AUTO_SCHEDULE_QUERY_FAILED[teaching_assignments]",
  "AUTO_SCHEDULE_QUERY_FAILED[rooms]",
  "AUTO_SCHEDULE_QUERY_FAILED[instructor_availability]",
  "AUTO_SCHEDULE_DELETE_FAILED",
  "AUTO_SCHEDULE_INSERT_FAILED",
]) {
  assert.ok(scheduler.includes(marker), `scheduler fail-closed marker: ${marker}`);
}
assert.equal(
  scheduler.includes("if (error || !data) return null"),
  false,
  "scheduler insert failure cannot become an ordinary unplaced candidate",
);

const lifecycleMigration = read(
  "supabase/migrations/20260718120000_source_only_atomic_schedule_version_lifecycle.sql",
);
assert.ok(lifecycleMigration.includes("SECURITY DEFINER"), "publish RPC is privileged");
assert.ok(
  lifecycleMigration.includes("SET search_path = public, pg_temp"),
  "publish RPC has fixed search_path",
);
assert.ok(
  lifecycleMigration.includes(
    "REVOKE ALL ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) FROM PUBLIC, anon",
  ),
  "publish RPC has explicit public/anon revoke",
);
assert.ok(
  lifecycleMigration.includes("REVOKE UPDATE ON public.schedule_versions FROM authenticated"),
  "direct schedule-version update bypass is revoked by source migration",
);

console.log("PASS stage-03a-fail-closed-contract.harness.ts");
