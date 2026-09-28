import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("policy migration guards activation and preserves all hard collectors", async () => {
  const sql = await read("supabase/migrations/20260928010000_scheduling_policy_requests.sql");

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.set_instructor_availability_enforcement/);
  assert.match(sql, /AVAILABILITY_NOT_READY/);
  assert.match(sql, /public\._ss_instructor_daily_hours/);
  assert.match(sql, /public\._ss_instructor_attendance_days/);
  assert.match(sql, /public\._ss_student_daily_hours/);
  assert.match(sql, /public\._ss_student_extended_days/);
  assert.match(sql, /public\._ss_itcs_theory_hours\(a,b,g,l\)/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\._ss_gather[\s\S]*TO service_role/);
});

test("manual builder exposes an identity-aware instructor perspective", async () => {
  const [route, workItems, queries, grid, perspective] = await Promise.all([
    read("src/routes/_authenticated/schedule-builder.tsx"),
    read("src/components/schedule-builder/v2-work-items-panel.tsx"),
    read("src/lib/schedule-builder/queries.ts"),
    read("src/components/timetable/timetable-grid.tsx"),
    read("src/lib/schedule-builder/instructor-perspective.ts"),
  ]);

  assert.match(route, /جدول المحاضر/);
  assert.match(route, /InstructorCombobox/);
  assert.match(route, /selectedInstructorRecordIds/);
  assert.match(route, /instructorIds=/);
  assert.match(route, /instructor-builder-planning-context/);
  assert.match(route, /fetchWorkspaceExternalBusySlots/);
  assert.match(route, /instructorSlotBlockReason/);
  assert.match(route, /instructorAvailabilityOverlay\.available/);
  assert.match(queries, /get_college_instructor_schedule_directory/);
  assert.match(queries, /get_schedule_external_busy/);
  assert.match(queries, /listInstructorSchedulingRequests/);
  assert.match(workItems, /allowed\.has\(row\.instructor_id\)/);
  assert.match(workItems, /جاهزة للإضافة/);
  assert.match(workItems, /تحتاج معالجة قبل الجدولة/);
  assert.match(grid, /readOnly\?: boolean/);
  assert.match(grid, /unavailability\?: AvailabilityWindow\[\]/);
  assert.match(perspective, /buildExternalBusyGridSessions/);
  assert.match(perspective, /evaluateInstructorSlotAvailability/);
});

test("the targeted Arts repair is fail-closed and leaves guards enabled", async () => {
  const sql = await read(
    "supabase/migrations/20260928040000_reschedule_inherited_arts_conflicts.sql",
  );

  assert.match(sql, /ARTS_CONFLICT_BASELINE_CHANGED/);
  assert.match(sql, /public\._ss_gather/);
  assert.match(sql, /schedule_coordination_private\.check_version/);
  assert.match(sql, /DISABLE TRIGGER trg_schedule_session_current_delivery_group/);
  assert.match(sql, /SET CONSTRAINTS ALL IMMEDIATE/);
  assert.match(sql, /ENABLE TRIGGER trg_schedule_session_current_delivery_group/);
  assert.match(sql, /resolve_inherited_cross_college_conflict/);
});
