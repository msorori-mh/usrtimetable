import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { session, snapshot, addCohort } from "./helpers/attendance-fixtures.mjs";
import { searchAttendance } from "../src/lib/auto-scheduler/attendance-search.ts";

// Execute the real orchestration; replace only I/O boundaries. No network or database writes.
const stubs = {
  "@/lib/schedule-builder/session-move-rpc":
    'export const moveOrRescheduleScheduleSession=async()=>{throw new Error("Generation must preserve existing sessions");};',
  "@/integrations/supabase/client": "export const supabase=globalThis.__jointSchedulerTest.db;",
  "@/lib/conflict-engine/scorer":
    "export const scoreScheduleVersion=async()=>({result:{hard_conflicts_count:0,soft_conflicts_count:0,total_score:80}});",
  "@/lib/schedule-builder/v2-assignment-service":
    'export const listScheduleBuilderV2WorkItems=async()=>({ok:true,can_manage:true,version_updated_at:"t0",rows:globalThis.__jointSchedulerTest.items});export const createScheduleSessionFromAssignmentV2=(p)=>globalThis.__jointSchedulerTest.create(p);',
  "@/lib/auto-scheduler/compact-service":
    "export const loadCompactSnapshot=async()=>structuredClone(globalThis.__jointSchedulerTest.snapshot);",
  "@/lib/auto-scheduler/compact-worker-client":
    "export const previewCompaction=(snapshot,options)=>globalThis.__jointSchedulerTest.plan(snapshot,options);",
};
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/auto-scheduler/v2.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "test-io",
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) =>
          args.path in stubs ? { path: args.path, namespace: "test-io" } : undefined,
        );
        b.onLoad({ filter: /.*/, namespace: "test-io" }, (args) => ({
          contents: stubs[args.path],
          loader: "js",
        }));
      },
    },
  ],
});
let serial = 0;
async function scheduler(state) {
  state.plan ??= async (snapshot, options) => {
    state.searchOptions = options;
    state.searchSnapshot = snapshot;
    return { attendanceSearch: await searchAttendance(snapshot, options) };
  };
  globalThis.__jointSchedulerTest = state;
  // A fresh module per test: written to a temp file because the bundle is larger
  // than a data: URL specifier may be.
  const file = join(mkdtempSync(join(tmpdir(), "v2-joint-")), `bundle-${serial++}.mjs`);
  writeFileSync(file, bundled.outputFiles[0].text);
  return (await import(pathToFileURL(file).href)).runV2AutoSchedule;
}
function item(id, cohort, group, extra = {}) {
  return {
    teaching_assignment_id: id,
    delivery_group_id: group,
    cohort_id: cohort,
    course_id: `course:${id}`,
    course_code: id,
    course_name: id,
    component_id: `component:${id}`,
    plan_course_component_id: `component:${id}`,
    component_type: "theory",
    instructor_id: "T",
    instructor_name: "T",
    assigned_component_hours: 2,
    expected_students: 30,
    study_system: "regular",
    group_code: group,
    course_offering_id: `offering:${id}`,
    session_type: "lecture",
    assignment_active: true,
    delivery_group_active: true,
    delivery_group_obsolete: false,
    is_project: false,
    is_summer_training: false,
    scheduling_status: "unscheduled",
    can_create_session: true,
    blocking_reason: null,
    ...extra,
  };
}
function state() {
  const s = snapshot([
    session("old", 0, "08:00:00", "10:00:00", {
      instructor_id: "T",
      teaching_assignment_id: "old",
    }),
  ]);
  s.assignments = [
    { id: "old", required_room_type: "lecture_hall", is_active: true },
    { id: "new", required_room_type: "lecture_hall", is_active: true },
  ];
  addCohort(s, "q", "gq", "q1");
  s.revision = "0";
  s.versionUpdatedAt = "t0";
  const st = {
    snapshot: s,
    items: [
      item("old", "c", "g", {
        scheduling_status: "scheduled",
        can_create_session: false,
      }),
      item("new", "q", "gq"),
    ],
    calls: [],
    runs: [],
    reject: false,
  };
  const tableRows = (table) => {
    if (table === "rooms") return st.snapshot.rooms;
    if (table === "time_slot_templates") return st.snapshot.templates;
    if (table === "schedule_sessions") return st.snapshot.sessions;
    // Keep this I/O contract aligned with the production V2 scheduler preflight queries.
    if (table === "room_types")
      return [
        { id: "rt-lecture", code: "lecture_hall" },
        { id: "rt-lab", code: "computer_lab" },
      ];
    if (table === "room_availability") return st.snapshot.roomAvailability;
    if (table === "academic_cohorts") return st.snapshot.cohorts;
    if (table === "plan_course_components")
      return st.items.map((i) => ({
        id: i.component_id,
        plan_course_id: `plan:${i.teaching_assignment_id}`,
        component_type: i.component_type,
        weekly_contact_hours: i.assigned_component_hours,
        required_room_type_id: null,
      }));
    if (table === "plan_courses")
      return st.items.map((i) => {
        const practical = i.component_type === "practical";
        return {
          id: `plan:${i.teaching_assignment_id}`,
          lectures_per_week: practical ? 0 : i.assigned_component_hours / 2,
          lecture_session_duration: 2,
          labs_per_week: practical ? i.assigned_component_hours / 2 : 0,
          lab_session_duration: 2,
          required_room_type_for_lecture: "lecture_hall",
          required_room_type_for_lab: "computer_lab",
        };
      });
    if (table === "operational_group_members")
      return st.snapshot.members.map((m) => ({
        ...m,
        partition_headcount: st.snapshot.partitions.find((p) => p.id === m.partition_id)?.headcount,
        partition_active: true,
      }));
    throw Error(`Unexpected query: ${table}`);
  };
  st.db = {
    rpc: async (name, request) => {
      if (name === "shared_lecture_catalog") return { data: [], error: null };
      assert.equal(name, "apply_schedule_generation");
      st.transactions ??= [];
      st.transactions.push(request);
      if (st.rejectJoint && st.transactions.length === 1)
        return {
          data: { ok: false, code: "FINAL_STATE_CONFLICT" },
          error: null,
        };
      if (st.transportFailure) return { data: null, error: { code: "NETWORK_ERROR" } };
      if (st.reject) return { data: { ok: false, code: "STALE_SNAPSHOT" }, error: null };
      const before = structuredClone(st.snapshot);
      for (const move of request.p_moves) {
        const row = st.snapshot.sessions.find((s) => s.id === move.id);
        assert.equal(row.is_locked, false);
        Object.assign(row, move);
        delete row.expected_updated_at;
      }
      const created = [];
      for (const a of request.p_additions) {
        const result = await st.create({
          teachingAssignmentId: a.teaching_assignment_id,
          dayOfWeek: a.day_of_week,
          startTime: a.start_time,
          endTime: a.end_time,
          roomId: a.room_id,
          note: request.p_note,
        });
        if (!result.ok) {
          st.snapshot = before;
          return { data: { ok: false, code: result.code }, error: null };
        }
        created.push(result.session);
      }
      st.snapshot.revision = String(Number(st.snapshot.revision) + 1);
      st.snapshot.versionUpdatedAt = `revision:${st.snapshot.revision}`;
      return {
        error: null,
        data: {
          ok: true,
          operation_id: request.p_operation_id,
          sessions: created,
          relocated: request.p_moves.length,
          revision: st.snapshot.revision,
          schedule_version_updated_at: st.snapshot.versionUpdatedAt,
        },
      };
    },
    auth: { getUser: async () => ({ data: { user: { id: "test-actor" } } }) },
    from(table) {
      let inserted = false;
      const filters = [];
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        in(column, values) {
          filters.push((row) => values.includes(row[column]));
          return q;
        },
        order() {
          return q;
        },
        insert(value) {
          assert.equal(table, "auto_schedule_runs");
          st.runs.push(value);
          inserted = true;
          return q;
        },
        single: async () => ({
          data: inserted ? { id: "run" } : null,
          error: null,
        }),
        then(resolve, reject) {
          return Promise.resolve({
            data: tableRows(table).filter((row) => filters.every((filter) => filter(row))),
            error: null,
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  st.rejectAssignments = new Set();
  st.create = async (p) => {
    st.calls.push(p);
    // Per-slot rejection: emulates a guarded RPC refusing one exact position.
    if (st.rejectSlot?.(p))
      return {
        ok: false,
        code: "SECTION_CONFLICT",
        stale: false,
        blocking_conflicts: [
          {
            code: "delivery_group_conflict",
            message_ar: "لا يوجد مرشح يحقق قيود المجموعة.",
          },
        ],
        warnings: [],
      };
    if (st.rejectAssignments.has(p.teachingAssignmentId))
      return {
        ok: false,
        code: "SECTION_CONFLICT",
        stale: false,
        blocking_conflicts: [
          {
            code: "delivery_group_conflict",
            message_ar: "لا يوجد مرشح يحقق قيود المجموعة.",
          },
        ],
        warnings: [],
      };
    if (st.reject)
      return {
        ok: false,
        code: "STALE_VERSION",
        stale: true,
        blocking_conflicts: [],
        warnings: [],
      };

    const i = st.items.find((i) => i.teaching_assignment_id === p.teachingAssignmentId);
    const created = session(`saved:${st.calls.length}`, p.dayOfWeek, p.startTime, p.endTime, {
      room_id: p.roomId,
      teaching_assignment_id: i.teaching_assignment_id,
      instructor_id: i.instructor_id,
      cohort_id: i.cohort_id,
      delivery_group_id: i.delivery_group_id,
      updated_at: `t${st.calls.length}`,
    });
    st.snapshot.sessions.push(created);
    return {
      ok: true,
      session: created,
      schedule_version_updated_at: `t${st.calls.length}`,
      blocking_conflicts: [],
      warnings: [],
    };
  };
  return st;
}
const params = { collegeId: "college", scheduleVersionId: "version" };

for (const studySystem of ["regular", "parallel", "both"]) {
  test(
    "V2 schedules " + studySystem + " using shared templates when no dedicated template exists",
    async () => {
      const s = state();
      s.snapshot.templates = s.snapshot.templates.map((template) => ({
        ...template,
        study_system: "both",
      }));
      s.items = s.items.map((entry) => ({
        ...entry,
        study_system: studySystem,
      }));
      s.snapshot.cohorts = s.snapshot.cohorts.map((cohort) => ({
        ...cohort,
        study_system: studySystem,
      }));
      await (
        await scheduler(s)
      )(params);
      assert.equal(s.calls.length, 1);
      assert.equal(s.runs[0].status, "completed");
      assert.equal(s.calls[0].startTime, "10:00:00");
    },
  );
}

test("empty portal blocks generation before any write", async () => {
  const s = state();
  s.items = [];
  await assert.rejects((await scheduler(s))(params), /لا توجد إسنادات/);
  assert.equal(s.calls.length, 0);
  assert.equal(s.runs.length, 0);
});
test("real V2 flow places next to the same instructor across programs and reads back completion", async () => {
  const s = state(),
    result = await (await scheduler(s))(params);
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].startTime, "10:00:00");
  assert.equal(s.runs[0].status, "completed");
  assert.equal(s.runs[0].summary.attendance.instructorGapMinutes, 0);
  assert.equal(result.totalRequired, 2);
  assert.equal(s.runs[0].summary.readiness.requiredMinutes, 240);
  assert.equal(s.snapshot.sessions.find((x) => x.id === "old").start_time, "08:00:00");
});
test("a sixth day is never sent to the creation RPC", async () => {
  const s = state();
  s.snapshot.sessions = [0, 1, 2, 3, 4].map((day) =>
    session(`old:${day}`, day, "08:00:00", "10:00:00", {
      instructor_id: "T",
      teaching_assignment_id: "old",
    }),
  );
  s.items = [item("new", "c", "g")];
  s.snapshot.templates = s.snapshot.templates.filter((t) => t.day_of_week === 6);
  await assert.rejects((await scheduler(s))(params), /ثبت التعذر/);
  assert.equal(s.calls.length, 0);
  assert.equal(s.runs.length, 0);
});
test("already scheduled 4-hour block cannot hide a required 2-by-2 cadence", async () => {
  const s = state();
  s.snapshot.sessions[0].end_time = "12:00:00";
  s.items[0].assigned_component_hours = 4;
  await (
    await scheduler(s)
  )(params);
  assert.equal(s.runs[0].status, "partial");
  assert.equal(s.runs[0].summary.readiness.nonconformingSessions, 1);
});
test("stale server response stops further writes and never records completion", async () => {
  const s = state();
  s.reject = true;
  await assert.rejects((await scheduler(s))(params), /STALE|تغيّر|تغير/);
  assert.equal(s.transactions.length, 1);
  assert.equal(s.calls.length, 0);
  assert.equal(s.runs.length, 0);
});
test("cancelled generation keeps the whole required scope visible", async () => {
  const s = state(),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    (await scheduler(s))({ ...params, signal: controller.signal }),
    /لم يُحسم البحث/,
  );
  assert.equal(s.calls.length, 0);
  assert.equal(s.runs.length, 0);
});

for (const [count, dailyHours, days] of [
  [8, 6, 3],
  [8, 4, 4],
  [9, 4, 5],
]) {
  test(`V2 writes only the complete certified ${days}-day plan`, async () => {
    const s = state();
    s.snapshot.sessions = [];
    s.items = Array.from({ length: count }, (_, i) => item(`a${i}`, "c", "g"));
    s.snapshot.assignments = s.items.map((i) => ({
      id: i.teaching_assignment_id,
      required_room_type: "lecture_hall",
      is_active: true,
    }));
    s.snapshot.settings.max_daily_hours_per_section = dailyHours;
    if (days === 5) {
      await assert.rejects((await scheduler(s))(params), /ثبت التعذر|لم يُحسم/);
      assert.equal(s.calls.length, 0);
      assert.equal(s.runs.length, 0);
    } else {
      const result = await (await scheduler(s))(params);
      assert.equal(result.placed, count);
      assert.equal(new Set(s.calls.map((c) => c.dayOfWeek)).size, days);
      assert.equal(s.transactions.length, 1);
      assert.equal(s.runs[0].status, "completed");
    }
  });
}

test("regular-only generation excludes parallel work before planning and preserves existing sessions", async () => {
  const s = state();
  const before = structuredClone(s.snapshot.sessions);
  s.items.push(
    item("parallel-blocked", "other", "other-group", {
      study_system: "parallel",
      can_create_session: false,
      scheduling_status: "blocked",
      blocking_reason: "parallel teacher not yet assigned",
    }),
  );
  const result = await (await scheduler(s))({ ...params, studySystem: "regular" });
  assert.deepEqual(
    s.calls.map((call) => call.teachingAssignmentId),
    ["new"],
  );
  assert.deepEqual(s.snapshot.sessions.slice(0, before.length), before);
  assert.equal(result.totalRequired, 2);
  assert.equal(result.studySystem, "regular");
  assert.equal(result.scopeComplete, true);
  assert.equal(s.runs[0].summary.study_system_scope, "regular");
  assert.equal(s.runs[0].summary.scope_complete, true);
  assert.equal(s.runs[0].status, "partial");
});
test("a mixed-system shared lecture blocks scoped generation before any session write", async () => {
  const s = state();
  s.items[1].study_system = "both";
  await assert.rejects((await scheduler(s))({ ...params, studySystem: "regular" }), /مشتركة/);
  assert.equal(s.calls.length, 0);
  assert.equal(s.runs.length, 0);
});

test("generation forwards its search budget and preserves actual lock state", async () => {
  const s = state();
  await (
    await scheduler(s)
  )({ ...params, searchDurationMs: 300000 });
  assert.equal(s.searchOptions.maxDurationMs, 300000);
  assert.equal(s.searchOptions.purpose, "generation");
  assert.equal(s.searchSnapshot.sessions.find((x) => x.id === "old").is_locked, false);
  assert.ok(
    s.searchSnapshot.sessions.some((x) => x.id.startsWith("attendance-pending:") && !x.is_locked),
  );
});

test("an unresolved worker search never reaches the session writer", async () => {
  const s = state();
  s.plan = async () => ({
    attendanceSearch: {
      status: "unknown",
      days: null,
      sessions: [],
      scope: "all_sessions_joint_grid",
      attempts: [{ days: 4, status: "unknown", reason: "budget", evaluated: 1 }],
    },
  });
  await assert.rejects((await scheduler(s))(params), /لم يُحسم البحث/);
  assert.equal(s.calls.length, 0);
});

for (const includeExistingWorkItem of [true, false]) {
  test(`parallel generation loads occupied regular student mappings (work item: ${includeExistingWorkItem})`, async () => {
    const s = state();
    const before = structuredClone(s.snapshot.sessions);
    s.items[1].study_system = "parallel";
    s.items[1].instructor_id = "U";
    s.snapshot.cohorts.find((c) => c.id === "q").study_system = "parallel";
    s.snapshot.instructors.push({
      id: "U",
      instructor_type_id: "permanent",
      max_hours_per_day: 6,
    });
    s.snapshot.rooms.push({ ...s.snapshot.rooms[0], id: "r2" });
    s.snapshot.templates = [
      {
        day_of_week: 0,
        start_time: "08:00:00",
        end_time: "10:00:00",
        study_system: "both",
        is_active: true,
      },
    ];
    if (!includeExistingWorkItem)
      s.items = s.items.filter((i) => i.teaching_assignment_id !== "old");
    const result = await (await scheduler(s))({ ...params, studySystem: "parallel" });
    assert.equal(result.placed, 1);
    assert.equal(result.scopeComplete, true);
    assert.equal(s.calls[0].startTime, "08:00:00");
    assert.equal(s.calls[0].roomId, "r2");
    assert.deepEqual(s.snapshot.sessions.slice(0, before.length), before);
  });
}

test("one infeasible work unit does not stop the remaining work items", async () => {
  const s = state();
  s.snapshot.sessions = [];
  s.items = [item("a0", "c", "g"), item("a1", "c", "g"), item("a2", "c", "g")];
  s.snapshot.settings.max_daily_hours_per_section = 6;
  s.snapshot.assignments = s.items.map((i) => ({
    id: i.teaching_assignment_id,
    required_room_type: "lecture_hall",
    is_active: true,
  }));
  // The first attempted unit is rejected by the guarded RPC on every candidate.
  s.rejectAssignments = new Set(["a0"]);
  const result = await (await scheduler(s))(params);
  const placedIds = new Set(
    s.calls.filter((c) => c.teachingAssignmentId !== "a0").map((c) => c.teachingAssignmentId),
  );
  assert.equal(placedIds.has("a1"), true);
  assert.equal(placedIds.has("a2"), true);
  assert.equal(s.runs[0].summary.cancelled, false);
  assert.equal(s.runs[0].summary.processed_work_items, 3);
  assert.equal(s.runs[0].summary.infeasible_work_units, 1);
  assert.equal(s.runs[0].unplaced.length, 1);
  assert.equal(s.runs[0].unplaced[0].teaching_assignment_id, "a0");
  assert.equal(result.placed, 2);
  assert.equal(s.runs[0].summary.readiness.remainingSessions, 1);
});

// JAWF-FALLBACK-01 regression: a rejected planned position must not strand a
// missing session while a legal, day-cap-preserving alternative exists.
test("rejected planned slot falls back to a legal alternative without moving existing sessions", async () => {
  const s = state();
  const before = structuredClone(s.snapshot.sessions);
  const planned = [];
  s.rejectSlot = (p) => {
    if (planned.length === 0) planned.push(p);
    const first = planned[0];
    // The exact planned position stays rejected; alternatives are accepted.
    return (
      p.dayOfWeek === first.dayOfWeek &&
      p.startTime === first.startTime &&
      p.roomId === first.roomId
    );
  };
  const result = await (await scheduler(s))(params);
  assert.equal(result.placed, 1);
  assert.ok(s.calls.length >= 2);
  assert.equal(s.runs[0].summary.local_fallback_placed_sessions, 1);
  const accepted = s.calls[s.calls.length - 1];
  assert.notDeepEqual(
    [accepted.dayOfWeek, accepted.startTime, accepted.roomId],
    [planned[0].dayOfWeek, planned[0].startTime, planned[0].roomId],
  );
  // Existing sessions are untouched by the fallback.
  assert.deepEqual(s.snapshot.sessions.slice(0, before.length), before);
});

test("fallback never opens a fifth student day beyond the certified plan", async () => {
  const s = state();
  s.snapshot.sessions = [];
  s.items = Array.from({ length: 8 }, (_, i) => item(`a${i}`, "c", "g"));
  s.snapshot.assignments = s.items.map((i) => ({
    id: i.teaching_assignment_id,
    required_room_type: "lecture_hall",
    is_active: true,
  }));
  s.snapshot.settings.max_daily_hours_per_section = 4;
  // Reject every planned position so the fallback is exercised for each unit.
  const rejected = new Set();
  s.rejectSlot = (p) => {
    const key = `${p.teachingAssignmentId}`;
    if (rejected.has(key)) return false;
    rejected.add(key);
    return true;
  };
  await (
    await scheduler(s)
  )(params);
  const studentDays = new Set(s.calls.filter((c) => c.note).map((c) => c.dayOfWeek));
  assert.ok(studentDays.size <= 4, `student days: ${[...studentDays]}`);
});

test("fallback keeps an untargeted instructor at the generic four-day cap", async () => {
  const s = state();
  s.snapshot.sessions = [];
  s.items = Array.from({ length: 8 }, (_, i) => item(`a${i}`, "c", "g"));
  s.snapshot.assignments = s.items.map((i) => ({
    id: i.teaching_assignment_id,
    required_room_type: "lecture_hall",
    is_active: true,
  }));
  s.snapshot.instructors = [{ id: "T", instructor_type_id: "permanent", max_hours_per_day: 6 }];
  s.snapshot.settings.max_daily_hours_per_section = 4;
  const seen = new Set();
  s.rejectSlot = (p) => {
    if (seen.has(p.teachingAssignmentId)) return false;
    seen.add(p.teachingAssignmentId);
    return true;
  };
  await (
    await scheduler(s)
  )(params);
  const days = new Set(s.snapshot.sessions.map((x) => x.day_of_week));
  assert.ok(days.size <= 4, `instructor days: ${[...days]}`);
});

test("a targeted instructor (target=5) may use a fifth day when students allow it", async () => {
  const s = state();
  s.snapshot.sessions = [];
  s.items = Array.from({ length: 9 }, (_, i) => item(`a${i}`, "c", "g"));
  s.snapshot.assignments = s.items.map((i) => ({
    id: i.teaching_assignment_id,
    required_room_type: "lecture_hall",
    is_active: true,
  }));
  s.snapshot.instructors = [
    {
      id: "T",
      instructor_type_id: "permanent",
      max_hours_per_day: 6,
      target_attendance_days_per_week: 5,
    },
  ];
  s.snapshot.settings.max_daily_hours_per_section = 4;
  const result = await (await scheduler(s))(params);
  assert.equal(result.placed, 9);
  assert.equal(new Set(s.calls.map((c) => c.dayOfWeek)).size, 5);
});

// PRACTICAL-ROOM-POLICY-02: practical groups at levels 3/4 keep the computer lab
// as first priority; a lecture hall is a fallback only, and never merges groups.
function practicalState(level, rooms) {
  const s = state();
  s.snapshot.sessions = [];
  s.snapshot.rooms = rooms;
  s.snapshot.cohorts = s.snapshot.cohorts.map((c) => ({
    ...c,
    level_id: level,
  }));
  s.items = [
    item("p1", "c", "g", {
      component_type: "practical",
      session_type: "lab",
      instructor_id: "T",
    }),
  ];
  s.snapshot.assignments = [
    {
      id: "p1",
      required_room_type: "computer_lab",
      is_active: true,
      plan_course_component_id: "component:p1",
    },
  ];
  s.snapshot.components = [{ id: "component:p1", component_type: "practical" }];
  s.snapshot.instructors = [{ id: "T", instructor_type_id: "permanent", max_hours_per_day: 6 }];
  return s;
}
const lab = {
  id: "lab-1",
  capacity: 40,
  room_type: "computer_lab",
  is_active: true,
};
const hall = {
  id: "hall-1",
  capacity: 40,
  room_type: "lecture_hall",
  is_active: true,
};

for (const level of ["3", "4"]) {
  test(`practical level ${level} prefers a valid computer lab over a lecture hall`, async () => {
    const s = practicalState(level, [lab, hall]);
    const result = await (await scheduler(s))(params);
    assert.equal(result.placed, 1);
    assert.equal(s.calls.at(-1).roomId, "lab-1");
    assert.equal(result.practicalRoomFallbacks, 0);
  });

  test(`practical level ${level} accepts a lecture hall only when no lab is valid`, async () => {
    const s = practicalState(level, [hall]);
    const result = await (await scheduler(s))(params);
    assert.equal(result.placed, 1);
    assert.equal(s.calls.at(-1).roomId, "hall-1");
    assert.equal(result.practicalRoomFallbacks, 1);
  });
}

test("hall fallback keeps two practical groups as two independent sessions", async () => {
  const s = practicalState("3", [hall, { ...hall, id: "hall-2" }]);
  addCohort(s.snapshot, "c2", "g2", "p2", 30);
  s.items.push(
    item("p2", "c2", "g2", {
      component_type: "practical",
      session_type: "lab",
      instructor_id: "T",
      group_code: "G2",
    }),
  );
  s.items[0].group_code = "G1";
  s.snapshot.cohorts = s.snapshot.cohorts.map((c) => ({ ...c, level_id: "3" }));
  s.snapshot.assignments = s.items.map((i) => ({
    id: i.teaching_assignment_id,
    required_room_type: "computer_lab",
    is_active: true,
    plan_course_component_id: i.component_id,
  }));
  s.snapshot.components = s.items.map((i) => ({
    id: i.component_id,
    component_type: "practical",
  }));
  const result = await (await scheduler(s))(params);
  assert.equal(result.placed, 2);
  // Distinct assignments, distinct delivery groups: no merge, no shared lecture.
  assert.deepEqual(new Set(s.calls.map((c) => c.teachingAssignmentId)), new Set(["p1", "p2"]));
  assert.equal(new Set(s.snapshot.sessions.map((x) => x.delivery_group_id)).size, 2);
  assert.equal(s.snapshot.sessions.length, 2);
});

test("hall fallback never overrides capacity, and conflicts stay blocking", async () => {
  const s = practicalState("4", [{ ...hall, capacity: 10 }]);
  s.items[0].expected_students = 30;
  await assert.rejects((await scheduler(s))(params), /.*/);
  assert.equal(s.calls.length, 0);

  const blocked = practicalState("4", [hall]);
  blocked.rejectAssignments = new Set(["p1"]);
  const result = await (await scheduler(blocked))(params);
  assert.equal(result.placed, 0);
  assert.equal(result.unplaced.length, 1);
});

for (const fallback of [false, true]) {
  test(`real V2 relocates earlier unlocked work (${fallback ? "bounded fallback" : "joint generation"})`, async () => {
    const s = state();
    s.items[1].instructor_id = "U";
    s.snapshot.instructors.push({
      id: "U",
      instructor_type_id: "permanent",
      max_hours_per_day: 6,
    });
    s.snapshot.settings.working_days = [0];
    s.snapshot.settings.day_end_time = "12:00:00";
    s.snapshot.settings.enforce_instructor_availability = true;
    s.snapshot.availability = [
      {
        instructor_id: "U",
        day_of_week: 0,
        start_time: "08:00:00",
        end_time: "10:00:00",
        availability_type: "available",
        is_preference: false,
      },
    ];
    s.rejectJoint = fallback;
    const result = await (await scheduler(s))(params);
    assert.equal(result.placed, 1);
    assert.equal(result.relocatedSessions, 1);
    assert.equal(s.snapshot.sessions.find((x) => x.id === "old").start_time, "10:00:00");
    assert.equal(
      s.snapshot.sessions.find((x) => x.teaching_assignment_id === "new").start_time,
      "08:00:00",
    );
    assert.equal(s.runs[0].status, "completed");
    assert.equal(s.transactions.at(-1).p_moves.length, 1);
    assert.equal(s.transactions.at(-1).p_additions.length, 1);
    if (fallback) {
      assert.ok(s.runs[0].summary.repair_attempts > 0);
      assert.equal(s.runs[0].summary.repair_placed_sessions, 1);
    }
  });
}
test("unknown transaction outcome stops immediately without another write", async () => {
  const s = state();
  s.transportFailure = true;
  await assert.rejects((await scheduler(s))(params), /غير مؤكدة/);
  assert.equal(s.transactions.length, 1);
  assert.equal(s.calls.length, 0);
  assert.equal(s.runs.length, 0);
});
