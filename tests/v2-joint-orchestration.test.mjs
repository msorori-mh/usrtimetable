import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
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
  return (
    await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text + `\n// test ${serial++}`).toString("base64")}`
    )
  ).runV2AutoSchedule;
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
    if (table === "room_types") return [{ id: "rt-lecture", code: "lecture_hall" }];
    if (table === "room_availability") return st.snapshot.roomAvailability;
    if (table === "academic_cohorts") return st.snapshot.cohorts;
    if (table === "plan_course_components")
      return st.items.map((i) => ({
        id: i.component_id,
        plan_course_id: `plan:${i.teaching_assignment_id}`,
        component_type: "theory",
        weekly_contact_hours: i.assigned_component_hours,
        required_room_type_id: null,
      }));
    if (table === "plan_courses")
      return st.items.map((i) => ({
        id: `plan:${i.teaching_assignment_id}`,
        lectures_per_week: i.assigned_component_hours / 2,
        lecture_session_duration: 2,
        labs_per_week: 0,
        lab_session_duration: 2,
        required_room_type_for_lecture: "lecture_hall",
      }));
    if (table === "operational_group_members")
      return st.snapshot.members.map((m) => ({
        ...m,
        partition_headcount: st.snapshot.partitions.find((p) => p.id === m.partition_id)?.headcount,
        partition_active: true,
      }));
    throw Error(`Unexpected query: ${table}`);
  };
  st.db = {
    rpc: async (name) => {
      assert.equal(name, "shared_lecture_catalog");
      return { data: [], error: null };
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
    if (st.rejectAssignments.has(p.teachingAssignmentId))
      return {
        ok: false,
        code: "SECTION_CONFLICT",
        stale: false,
        blocking_conflicts: [
          { code: "delivery_group_conflict", message_ar: "لا يوجد مرشح يحقق قيود المجموعة." },
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
  assert.equal(s.calls.length, 1);
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
    const result = await (await scheduler(s))(params);
    if (days === 5) {
      // A single instructor cannot satisfy a five-day certified student plan:
      // generation must stop incomplete rather than violate the four-day ceiling.
      assert.ok(result.placed < count);
      assert.equal(s.runs[0].status, "partial");
      assert.ok(new Set(s.calls.map((c) => c.dayOfWeek)).size <= 4);
    } else {
      assert.equal(result.placed, count);
      assert.equal(new Set(s.calls.map((c) => c.dayOfWeek)).size, days);
      assert.ok(s.calls.every((c) => c.note.includes(`attendance:${days}`)));
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

test("generation forwards its search budget and fixes existing placements", async () => {
  const s = state();
  await (
    await scheduler(s)
  )({ ...params, searchDurationMs: 300000 });
  assert.equal(s.searchOptions.maxDurationMs, 300000);
  assert.equal(s.searchOptions.purpose, "generation");
  assert.equal(s.searchSnapshot.sessions.find((x) => x.id === "old").is_locked, true);
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
    s.snapshot.instructors.push({ id: "U", instructor_type_id: "permanent", max_hours_per_day: 6 });
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
  s.items = [item("a0", "c", "g"), item("a1", "c", "g2"), item("a2", "c", "g3")];
  s.snapshot.assignments = s.items.map((i) => ({
    id: i.teaching_assignment_id,
    required_room_type: "lecture_hall",
    is_active: true,
  }));
  // The first attempted unit is rejected by the guarded RPC on every candidate.
  s.rejectAssignments = new Set(["a0"]);
  const result = await (await scheduler(s))(params);
  const placedIds = new Set(
    s.calls
      .filter((c) => c.teachingAssignmentId !== "a0")
      .map((c) => c.teachingAssignmentId),
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
