/**
 * Conflict-check page: validateScheduleVersion validates the whole version with ONE
 * server call (public.validate_schedule_version, the same computation as the publish
 * gate — Q-2 / M-12) instead of a browser batch pass, then persists the results.
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
let enforceInstructorAvailability = false;
let instructorAvailabilityRows: unknown[] = [];
let schedulingPolicyError: { message: string } | null = null;
let serverConflicts: unknown[] = [];
let serverError: { message: string } | null = null;

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
    case "instructor_availability":
      return instructorAvailabilityRows;
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
  // The fluent PostgREST mock intentionally returns itself from differently
  // shaped methods; keeping one dynamic test double is clearer than casting
  // every chained method separately.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    maybeSingle: async () =>
      table === "scheduling_settings"
        ? {
            data: {
              enforce_instructor_availability: enforceInstructorAvailability,
            },
            error: schedulingPolicyError,
          }
        : { data: null, error: null },
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
      if (name === "validate_schedule_version") {
        if (serverError) return { data: null, error: serverError };
        const hard = serverConflicts.filter(
          (c) => (c as { severity?: string }).severity !== "soft",
        ).length;
        return {
          data: {
            version_id: DRAFT,
            session_count: SESSION_COUNT,
            hard_count: hard,
            approved_count: 0,
            waived_count: 0,
            total_hard_count: hard,
            soft_count: 0,
            conflicts: serverConflicts,
          },
          error: null,
        };
      }
      if (name === "get_cohort_component_instructor_readiness") {
        return {
          data: { ok: true, violation_count: 0, violations: [] },
          error: null,
        };
      }
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

const { validateScheduleVersion, dedupeConflicts } =
  await import("../src/lib/conflict-engine/validator");

describe("validateScheduleVersion server pass", () => {
  it("validates the whole version with one server call and no browser rule pass", async () => {
    reads = {};
    serverConflicts = [];
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
    assert.equal(reads["rpc:validate_schedule_version"], 1, "one server validation");
    for (const table of ["schedule_sessions", "rooms", "instructor_availability", "course_offerings"]) {
      assert.equal(reads[table] ?? 0, 0, `${table} must not be re-validated in the browser`);
    }
    assert.ok(elapsed < 10_000, `must finish quickly, took ${elapsed}ms`);
  });

  it("returns the server's conflicts (including rules the browser never checked)", async () => {
    reads = {};
    serverConflicts = [
      {
        code: "itcs_theory_after_14",
        severity: "hard",
        schedule_session_id: sessions[0].id,
        approved_exception: false,
      },
    ];
    try {
      const { result } = await validateScheduleVersion({
        collegeId: COLLEGE,
        scheduleVersionId: DRAFT,
        persist: false,
      });
      assert.equal(result.totalHardConflicts, 1);
      assert.equal(result.unapprovedHardConflicts, 1);
      assert.equal(result.conflicts[0]?.code, "itcs_theory_after_14");
      assert.equal(result.conflicts[0]?.schedule_session_id, sessions[0].id);
    } finally {
      serverConflicts = [];
    }
  });

  it("fails closed when the server validation cannot run", async () => {
    reads = {};
    serverError = { message: "validation denied" };
    try {
      await assert.rejects(
        validateScheduleVersion({
          collegeId: COLLEGE,
          scheduleVersionId: DRAFT,
          persist: false,
        }),
        /validation denied/,
      );
    } finally {
      serverError = null;
    }
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
