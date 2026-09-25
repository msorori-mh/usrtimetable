import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { snapshot, session } from "./helpers/attendance-fixtures.mjs";
import {
  feasible,
  fingerprint,
  inputFingerprint,
  measure,
} from "../src/lib/auto-scheduler/compact.ts";

const bundle = await build({
  entryPoints: [
    fileURLToPath(new URL("../src/lib/auto-scheduler/compact-service.ts", import.meta.url)),
  ],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: [
    {
      name: "atomic-io",
      setup(b) {
        b.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({
          path: "db",
          namespace: "atomic-io",
        }));
        b.onLoad({ filter: /.*/, namespace: "atomic-io" }, () => ({
          contents: "export const supabase=globalThis.__atomicDb;",
        }));
      },
    },
  ],
});
const source = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
let serial = 0;

test("quality proposals use atomic relayout with the existing day ceiling", async () => {
  const { st, service, p } = await setup();
  p.applicationMode = "simultaneous";
  p.qualitySearch = { dayCap: 4 };
  const result = await service.applyCompactProposal("c", "v", p);
  assert.equal(result.status, "saved");
  assert.equal(st.calls[0].name, "apply_schedule_relayout");
  assert.equal(st.calls[0].args.p_day_cap, 4);
  assert.equal(result.after.instructorGapMinutes, 0);
});

test("the compact snapshot uses selected-version group and partition sizes", async () => {
  const { st, service } = await setup();
  st.versionHeadcount = 42;
  const version = await service.loadCompactSnapshot("c", "v");
  assert.equal(st.s.groups[0].expected_students, 30);
  assert.equal(version.groups[0].expected_students, 42);
  assert.equal(version.partitions[0].headcount, 42);
  assert.equal(version.sessions[0].expected_students, 42);
});

test("quality save independently rejects raising attendance days", async () => {
  const { st, service, p } = await setup();
  p.applicationMode = "simultaneous";
  p.qualitySearch = { dayCap: 4 };
  p.moves[0].day_of_week = 1;
  await assert.rejects(service.applyCompactProposal("c", "v", p), /صلاحية/);
  assert.equal(st.calls.length, 0);
});

test("quality marker cannot select sequential persistence", async () => {
  const { st, service, p } = await setup();
  p.qualitySearch = { dayCap: 4 };
  await assert.rejects(service.applyCompactProposal("c", "v", p), /متزامن/);
  assert.equal(st.calls.length, 0);
});

async function setup() {
  const s = snapshot([
    session("a", 0, "08:00:00", "10:00:00", { instructor_id: "T" }),
    session("b", 0, "12:00:00", "14:00:00", { instructor_id: "T" }),
  ]);
  s.revision = "7";
  s.versionUpdatedAt = "version-t0";
  const st = {
    s,
    calls: [],
    receipt: null,
    mode: "saved",
    reads: 0,
    pages: [],
    duringRead: false,
    afterDispatch: null,
    failRefresh: false,
  };
  const mapping = {
    schedule_sessions: "sessions",
    academic_cohorts: "cohorts",
    operational_delivery_groups: "groups",
    operational_group_members: "members",
    shared_lecture_links: "sharedLectures",
    plan_course_components: "components",
    cohort_student_partitions: "partitions",
    teaching_assignments: "assignments",
    rooms: "rooms",
    instructors: "instructors",
    instructor_types: "types",
    instructor_availability: "availability",
    room_availability: "roomAvailability",
    room_unavailability: "roomUnavailability",
    time_slot_templates: "templates",
    scheduling_settings: "settings",
  };
  globalThis.__atomicDb = {
    from(table) {
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: (column) => {
          assert.equal(column, table === "shared_lecture_links" ? "member_group_id" : "id");
          return q;
        },
        async single() {
          st.reads++;
          if (st.failRefresh && st.calls.length) throw new Error("offline refresh");
          if (st.duringRead && st.reads === 2) st.s.revision = "8";
          return {
            data: {
              id: "v",
              status: "draft",
              eligibility_revision: Number(st.s.revision),
              updated_at: st.s.versionUpdatedAt,
            },
            error: null,
          };
        },
        async range(from, to) {
          if (table === "schedule_versions") {
            st.reads++;
            if (st.failRefresh && st.calls.length) throw new Error("offline refresh");
            if (st.duringRead && st.reads === 2) st.s.revision = "8";
            return {
              data: [
                {
                  id: "v",
                  status: "draft",
                  eligibility_revision: Number(st.s.revision),
                  updated_at: st.s.versionUpdatedAt,
                  instructor_attendance_overrides: {},
                },
              ],
              error: null,
            };
          }
          st.pages.push({ table, from, to });
          return {
            data: structuredClone(
              (table === "scheduling_settings"
                ? [st.s.settings]
                : (st.s[mapping[table]] ?? [])
              ).slice(from, to + 1),
            ),
            error: null,
          };
        },
      };
      return q;
    },
    async rpc(name, args) {
      if (name === "get_schedule_external_busy")
        return { data: st.s.externalBusy ?? [], error: null };
      if (name === "schedule_version_student_memberships")
        return {
          data: args.p_groups.flatMap((id) => {
            const group = st.s.groups.find((g) => g.id === id);
            if (!group) return [];
            const members = st.s.members.filter((m) => m.delivery_group_id === id);
            return (members.length ? members : [{ cohort_id: group.cohort_id }]).map((m) => ({
              delivery_group_id: id,
              cohort_id: m.cohort_id,
              partition_id: m.partition_id ?? null,
              partition_headcount:
                st.versionHeadcount ??
                st.s.partitions.find((p) => p.id === m.partition_id)?.headcount ??
                null,
              shared_lecture: false,
              expected_students: st.versionHeadcount ?? group.expected_students,
            }));
          }),
          error: null,
        };
      st.calls.push({ name, args });
      if (name === "get_schedule_compaction_result")
        return {
          data: st.receipt || { ok: false, code: "UNCONFIRMED" },
          error: null,
        };
      assert.ok(
        ["apply_schedule_compaction", "apply_schedule_relayout"].includes(name),
        "never fall back to individual moves",
      );
      st.afterDispatch?.();
      if (st.mode === "missing")
        return { data: null, error: { code: "PGRST202", message: "missing" } };
      if (st.mode === "reject")
        return {
          data: { ok: false, code: "BLOCKED_CONFLICTS", applied: 0 },
          error: null,
        };
      if (st.mode === "unknown") throw new Error("transport lost");
      if (st.mode === "busy")
        return {
          data: { ok: false, code: "VERSION_BUSY", applied: 0 },
          error: null,
        };
      for (const m of args.p_moves)
        st.s.sessions = st.s.sessions.map((x) =>
          x.id === m.id ? { ...x, ...m, updated_at: "t1" } : x,
        );
      st.s.revision = "8";
      st.receipt = {
        ok: true,
        code: "SAVED",
        applied: args.p_moves.length,
        operation_id: args.p_operation_id,
      };
      if (st.mode === "lost-response") throw new Error("response lost after commit");
      return { data: st.receipt, error: null };
    },
  };
  const service = await import(`${source}#${serial++}`);
  const fresh = await service.loadCompactSnapshot("c", "v");
  st.reads = 0;
  const moves = [
    {
      id: "b",
      day_of_week: 0,
      start_time: "10:00:00",
      end_time: "12:00:00",
      room_id: "r",
    },
  ];
  const p = {
    moves,
    before: measure(fresh),
    after: measure(fresh),
    fingerprint: fingerprint(fresh.sessions),
    inputFingerprint: inputFingerprint(fresh),
    stopped: false,
  };
  return { st, service, p };
}

test("one batch preserves original timestamps and reports only the committed result", async () => {
  const { st, service, p } = await setup();
  const progress = [];
  const r = await service.applyCompactProposal("c", "v", p, {
    onProgress: (...v) => progress.push(v),
  });
  assert.equal(r.status, "saved");
  assert.equal(r.applied, 1);
  assert.equal(r.after.studentGapMinutes, 0);
  assert.equal(st.calls.length, 1);
  assert.equal(st.calls[0].args.p_expected_revision, "7");
  assert.equal(st.calls[0].args.p_moves[0].expected_updated_at, "t0");
  assert.deepEqual(progress, [[1, 1]]);
});
test("server rejection reports zero applied and unchanged actual timetable", async () => {
  const { st, service, p } = await setup();
  st.mode = "reject";
  const r = await service.applyCompactProposal("c", "v", p);
  assert.equal(r.status, "rejected");
  assert.equal(r.applied, 0);
  assert.deepEqual(r.after, r.before);
});
test("a lost successful response is reconciled through the protected receipt", async () => {
  const { st, service, p } = await setup();
  st.mode = "lost-response";
  const r = await service.applyCompactProposal("c", "v", p);
  assert.equal(r.status, "saved");
  assert.equal(r.applied, 1);
  assert.deepEqual(
    st.calls.map((c) => c.name),
    ["apply_schedule_compaction", "get_schedule_compaction_result"],
  );
});
test("absence of a receipt remains unknown and verification never resubmits", async () => {
  const { st, service, p } = await setup();
  st.mode = "unknown";
  const r = await service.applyCompactProposal("c", "v", p);
  assert.equal(r.status, "unknown");
  assert.equal(r.applied, null);
  const next = await service.verifyCompactApplication("c", "v", r);
  assert.equal(next.status, "unknown");
  assert.equal(st.calls.filter((c) => c.name === "apply_schedule_compaction").length, 1);
  st.receipt = {
    ok: true,
    code: "SAVED",
    applied: 1,
    operation_id: r.operationId,
  };
  assert.equal((await service.verifyCompactApplication("c", "v", next)).status, "saved");
});
test("missing atomic RPC fails closed without a sequential fallback", async () => {
  const { st, service, p } = await setup();
  st.mode = "missing";
  const r = await service.applyCompactProposal("c", "v", p);
  assert.equal(r.status, "rejected");
  assert.equal(r.applied, 0);
  assert.equal(st.calls.length, 1);
});
test("revision mutation during the paginated read prevents a mixed snapshot", async () => {
  const { st, service } = await setup();
  st.duringRead = true;
  await assert.rejects(service.loadCompactSnapshot("c", "v"), /أثناء القراءة/);
  assert.equal(st.calls.length, 0);
});
test("a stale resource preview sends no database mutation", async () => {
  const { st, service, p } = await setup();
  st.s.settings.break_between_sessions_min = 15;
  await assert.rejects(service.applyCompactProposal("c", "v", p), /تغيرت البيانات/);
  assert.equal(st.calls.length, 0);
});
test("cancellation before dispatch writes nothing; cancellation after dispatch awaits the receipt", async () => {
  const { st, service, p } = await setup();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.applyCompactProposal("c", "v", p, { signal: controller.signal }),
    /قبل إرسال/,
  );
  assert.equal(st.calls.length, 0);
  const active = new AbortController();
  st.afterDispatch = () => active.abort();
  assert.equal(
    (await service.applyCompactProposal("c", "v", p, { signal: active.signal })).status,
    "saved",
  );
});
test("successful save remains confirmed if the following refresh fails", async () => {
  const { st, service, p } = await setup();
  st.failRefresh = true;
  const r = await service.applyCompactProposal("c", "v", p);
  assert.equal(r.status, "saved");
  assert.equal(r.applied, 1);
  assert.equal(r.after, null);
});
test("explicit recovery reuses the exact original operation and payload", async () => {
  const { st, service, p } = await setup();
  st.mode = "unknown";
  const previous = await service.applyCompactProposal("c", "v", p);
  const original = structuredClone(st.calls[0].args);
  st.mode = "saved";
  const recovered = await service.retryCompactApplication("c", "v", previous);
  assert.equal(recovered.status, "saved");
  assert.deepEqual(
    st.calls.filter((c) => c.name === "apply_schedule_compaction")[1].args,
    original,
  );
});
test("recovery meeting an in-flight lock stays unknown, not falsely rolled back", async () => {
  const { st, service, p } = await setup();
  st.mode = "unknown";
  const previous = await service.applyCompactProposal("c", "v", p);
  st.mode = "busy";
  const recovered = await service.retryCompactApplication("c", "v", previous);
  assert.equal(recovered.status, "unknown");
  assert.equal(recovered.applied, null);
});
test("recovery cannot send an old plan into a different selected version", async () => {
  const { st, service, p } = await setup();
  st.mode = "unknown";
  const previous = await service.applyCompactProposal("c", "v", p);
  await assert.rejects(service.retryCompactApplication("c", "different", previous), /تغيرت نسخة/);
  assert.equal(st.calls.filter((c) => c.name === "apply_schedule_compaction").length, 1);
});

test("simultaneous final plan can displace an occupied intermediate placement", async () => {
  const { st, service, p } = await setup();
  p.applicationMode = "simultaneous";
  p.attendanceSearch = {
    status: "feasible",
    days: 3,
    attempts: [],
    sessions: [],
    scope: "all_sessions_joint_grid",
  };
  p.moves.unshift({
    id: "a",
    day_of_week: 0,
    start_time: "12:00:00",
    end_time: "14:00:00",
    room_id: "r",
  });
  const saved = await service.applyCompactProposal("c", "v", p);
  assert.equal(saved.status, "saved");
  assert.equal(saved.applied, 2);
  assert.equal(st.calls[0].name, "apply_schedule_relayout");
  assert.equal(st.calls[0].args.p_day_cap, 3);
  assert.equal(saved.after.studentGapMinutes, 0);
});
test("simultaneous recovery retains its RPC and exact request", async () => {
  const { st, service, p } = await setup();
  p.applicationMode = "simultaneous";
  p.attendanceSearch = { days: 3 };
  st.mode = "unknown";
  const previous = await service.applyCompactProposal("c", "v", p);
  const request = structuredClone(st.calls[0]);
  st.mode = "saved";
  const saved = await service.retryCompactApplication("c", "v", previous);
  assert.equal(saved.status, "saved");
  assert.deepEqual(st.calls.filter((c) => c.name === "apply_schedule_relayout")[1], request);
});

test("external busy windows invalidate a preview without changing its local revision", async () => {
  const { st, service, p } = await setup();
  st.s.externalBusy = [
    {
      instructor_id: "T",
      day_of_week: 0,
      start_time: "10:00:00",
      end_time: "12:00:00",
    },
  ];
  await assert.rejects(service.applyCompactProposal("c", "v", p), /تغيرت البيانات/);
  assert.equal(st.calls.length, 0);
});

test("planning rejects external teacher overlap but accepts its exact end boundary", () => {
  const original = session("a", 0, "08:00:00", "10:00:00", { instructor_id: "T" });
  const s = snapshot([original]);
  assert.equal(feasible(s, [], original, original), true);
  s.externalBusy = [
    { instructor_id: "T", day_of_week: 0, start_time: "09:00:00", end_time: "11:00:00" },
  ];
  assert.equal(feasible(s, [], original, original), false);
  s.externalBusy[0].start_time = "10:00:00";
  assert.equal(feasible(s, [], original, original), true);
});

test("shared lecture links load across pages using their real primary key", async () => {
  const { st, service } = await setup();
  st.s.sharedLectures = Array.from({ length: 501 }, (_, i) => ({
    member_group_id: `member-${i}`,
    anchor_group_id: "anchor",
    college_id: "c",
  }));
  st.pages = [];
  const loaded = await service.loadCompactSnapshot("c", "v");
  assert.deepEqual(loaded.sharedLectures, st.s.sharedLectures);
  assert.deepEqual(
    st.pages.filter((p) => p.table === "shared_lecture_links").map((p) => [p.from, p.to]),
    [
      [0, 499],
      [500, 999],
    ],
  );
});

test("rollback restores the exact original placements through one validated atomic request", async () => {
  const { st, service, p } = await setup();
  const before = await service.loadCompactSnapshot("c", "v");
  await service.applyCompactProposal("c", "v", p);
  const saved = await service.loadCompactSnapshot("c", "v");
  const result = await service.restoreCompactApplication("c", "v", { before, saved });
  assert.equal(result.status, "saved");
  assert.equal(st.calls.at(-1).name, "apply_schedule_relayout");
  assert.equal(result.after.instructorGapMinutes, before.sessions.length === 2 ? 120 : -1);
});

test("rollback refuses intervening edits before sending any mutation", async () => {
  const { st, service, p } = await setup();
  const before = await service.loadCompactSnapshot("c", "v");
  await service.applyCompactProposal("c", "v", p);
  const saved = structuredClone(await service.loadCompactSnapshot("c", "v"));
  const count = st.calls.length;
  st.s.revision = String(Number(st.s.revision) + 1);
  await assert.rejects(service.restoreCompactApplication("c", "v", { before, saved }), /تغير/);
  assert.equal(st.calls.length, count);
});

test("atomic quality save accepts an equal-metric hard repair but rejects a pointless move", async () => {
  for (const conflict of [false, true]) {
    const { st, service, p } = await setup();
    st.s.sessions = [session("a", 0, "08:00:00", "10:00:00", { instructor_id: "T" })];
    st.s.externalBusy = conflict
      ? [{ instructor_id: "T", day_of_week: 0, start_time: "08:00:00", end_time: "10:00:00" }]
      : [];
    const fresh = await service.loadCompactSnapshot("c", "v");
    p.fingerprint = fingerprint(fresh.sessions);
    p.inputFingerprint = inputFingerprint(fresh);
    p.before = measure(fresh);
    p.applicationMode = "simultaneous";
    p.qualitySearch = { dayCap: 3 };
    p.moves = [
      { id: "a", day_of_week: 0, start_time: "10:00:00", end_time: "12:00:00", room_id: "r" },
    ];
    if (conflict) {
      const r = await service.applyCompactProposal("c", "v", p);
      assert.equal(r.status, "saved");
      assert.equal(r.applied, 1);
    } else {
      await assert.rejects(service.applyCompactProposal("c", "v", p), /لا تحسّن/);
      assert.equal(st.calls.length, 0);
    }
  }
});
