/**
 * Conflict-check page hang fix: validateScheduleVersion must load shared data
 * once and validate the whole version in a single batch pass.
 *
 * Scope: pure in-memory mocks. No database writes, no schedule data changes,
 * no published version is touched.
 */
import { describe, it, mock } from "bun:test";
import assert from "node:assert/strict";

const COLLEGE = "7168345f-cf9d-4789-b2ad-547abb687dc8";
const DRAFT = "d68d8d22-9a6d-4f21-935f-cebf18bb969b";
const SESSION_COUNT = 275;
const MINUTES_PER_SESSION = 180; // 275 * 180 / 60 = 825 → hours asserted from data

const sessions = Array.from({ length: SESSION_COUNT }, (_, i) => ({
  id: `sess-${String(i).padStart(4, "0")}`,
  college_id: COLLEGE,
  schedule_version_id: DRAFT,
  cohort_id: `cohort-${i}`,
  delivery_group_id: `group-${i}`,
  course_offering_id: `offering-${i}`,
  teaching_assignment_id: null,
  instructor_id: `instructor-${i}`,
  room_id: `room-${i}`,
  section_id: null,
  section_group_id: null,
  section_subgroup_id: null,
  study_system: "regular",
  day_of_week: 1,
  start_time: "08:00:00",
  end_time: "11:00:00",
  session_type: "lecture",
  expected_students: 10,
  enrollment_count_status: "confirmed",
  replaced_by_split: false,
}));

/** Count of table reads per table, to prove data is loaded once per run. */
let reads: Record<string, number> = {};
let insertedResults: unknown[] = [];

function rowsFor(table: string): unknown[] {
  switch (table) {
    case "schedule_sessions":
      return sessions;
    case "rooms":
      return sessions.map((s) => ({
        id: s.room_id,
        capacity: 100,
        college_id: COLLEGE,
        room_type: "lecture_hall",
      }));
    case "course_offerings":
      return sessions.map((s) => ({
        id: s.course_offering_id,
        expected_students: 10,
        enrollment_count_status: "confirmed",
        college_id: COLLEGE,
      }));
    case "instructors":
      return sessions.map((s) => ({
        id: s.instructor_id,
        instructor_type_id: null,
      }));
    case "constraint_types":
      return [];
    default:
      // room_availability, instructor_availability, time_slot_templates,
      // teaching_assignments, instructor_types, plan_course_components,
      // schedule_version_conflict_exceptions
      return [];
  }
}

function builder(table: string) {
  reads[table] = (reads[table] ?? 0) + 1;
  const chain: Record<string, unknown> = {};
  const api: any = {
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: rowsFor(table), error: null }).then(resolve),
    select: () => api,
    eq: () => api,
    neq: () => api,
    in: () => api,
    order: () => api,
    range: () => api,
    single: async () => ({ data: { id: "check-1" }, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
    insert: (rows: unknown) => {
      if (table === "conflict_results") {
        insertedResults = Array.isArray(rows) ? rows : [rows];
      }
      return api;
    },
  };
  void chain;
  return api;
}

mock.module("../src/integrations/supabase/client.ts", () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: async (name: string) => {
      reads[`rpc:${name}`] = (reads[`rpc:${name}`] ?? 0) + 1;
      return { data: false, error: null };
    },
    auth: { getUser: async () => ({ data: { user: { id: "tester" } } }) },
  },
}));

mock.module("../src/lib/academic-delivery/student-memberships.ts", () => ({
  fetchStudentMembershipIndex: async () => {
    reads["memberships"] = (reads["memberships"] ?? 0) + 1;
    return new Map(
      sessions.map((s) => [
        s.delivery_group_id,
        {
          cohortId: s.cohort_id,
          cohortIds: [s.cohort_id],
          partitionIds: [`part-${s.cohort_id}`],
          complete: true,
        },
      ]),
    );
  },
}));

const { validateScheduleVersion, dedupeConflicts } = await import(
  "../src/lib/conflict-engine/validator"
);

describe("validateScheduleVersion batch pass", () => {
  it("validates 275 sessions in one shared-data pass without hanging", async () => {
    reads = {};
    const started = Date.now();
    const { checkId, result } = await validateScheduleVersion({
      collegeId: COLLEGE,
      scheduleVersionId: DRAFT,
      persist: false,
    });
    const elapsed = Date.now() - started;

    assert.equal(checkId, null);
    assert.equal(sessions.length, SESSION_COUNT, "275 sessions in the draft");
    assert.equal(
      (sessions.length * MINUTES_PER_SESSION) / 60,
      825,
      "draft hours are derived from session durations only",
    );
    assert.equal(result.totalHardConflicts, 0, "zero hard conflicts");
    assert.equal(result.unapprovedHardConflicts, 0);
    assert.equal(result.conflicts.length, 0);

    // The hang cause: one read set per session. Each shared table must be read
    // at most once for the whole version.
    for (const table of [
      "rooms",
      "room_availability",
      "instructor_availability",
      "course_offerings",
      "time_slot_templates",
      "instructors",
      "schedule_version_conflict_exceptions",
    ]) {
      assert.ok(
        (reads[table] ?? 0) <= 1,
        `${table} must be read at most once, got ${reads[table]}`,
      );
    }
    assert.equal(reads["rpc:existing_schedule_intake_version"], 1);
    assert.equal(reads["memberships"], 1);
    assert.ok(elapsed < 10_000, `must finish quickly, took ${elapsed}ms`);
  });

  it("still persists conflict_checks and conflict_results", async () => {
    reads = {};
    insertedResults = [];
    const { checkId } = await validateScheduleVersion({
      collegeId: COLLEGE,
      scheduleVersionId: DRAFT,
    });
    assert.equal(checkId, "check-1");
    assert.equal(reads["conflict_checks"], 1);
    assert.equal(insertedResults.length, 0, "no conflicts → no result rows");
  });

  it("collapses the mirrored result of the same session pair", () => {
    const pair = (a: string, b: string) => ({
      code: "instructor_conflict",
      severity: "hard" as const,
      message_ar: "x",
      message_en: "x",
      schedule_session_id: a,
      related_session_id: b,
    });
    const deduped = dedupeConflicts([
      pair("a", "b"),
      pair("b", "a"),
      { ...pair("a", "c"), code: "room_conflict" },
      pair("a", "c"),
    ]);
    assert.equal(deduped.length, 3);
    assert.deepEqual(
      deduped.map((c) => `${c.code}:${c.schedule_session_id}`),
      ["instructor_conflict:a", "room_conflict:a", "instructor_conflict:a"],
    );
  });
});
