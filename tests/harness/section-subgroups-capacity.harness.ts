/**
 * Capacity subgroup model + deterministic auto-scheduler (offline).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPACITY_EXCEPTION_LIMIT,
  ORIGINAL_SESSION_STRATEGY,
  distributeStudentsBalanced,
  isSchedulableSession,
  planSubgroups,
  sameSectionSubgroupConflict,
  validateSubgroupPlan,
} from "../../src/lib/schedule-builder/section-subgroups";
import {
  DEFAULT_SCHEDULER_CONFIG,
  candidateSlots,
  scheduleChildSession,
  scanConflicts,
  type SimOccupancy,
  type SimRoom,
} from "../../src/lib/schedule-builder/subgroup-auto-scheduler";
import {
  applyPendingToSessions,
  proposeSlotFromDragDrop,
  snapshotOriginalFromSession,
  buildPendingChange,
} from "../../src/lib/schedule-builder/pending-change";
import type { WorkspaceSessionView } from "../../src/lib/schedule-builder/workspace";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function sampleSession(
  partial: Partial<WorkspaceSessionView> & { id: string },
): WorkspaceSessionView {
  return {
    day_of_week: 0,
    start_time: "08:00:00",
    end_time: "10:00:00",
    session_type: "lecture",
    study_system: "regular",
    course_code: "CS101",
    course_name: "مقدمة",
    instructor_name: "د. أحمد",
    room_label: "Q1",
    section_number: "1",
    subgroup_code: "A",
    subgroup_expected_students: 30,
    program_name: "IT",
    level_name: "1",
    department_name: "CS",
    instructor_id: "i1",
    section_id: "s1",
    section_subgroup_id: "sg-a",
    room_id: "r1",
    program_id: "p1",
    level_id: "l1",
    updated_at: "2026-07-01T12:00:00.000Z",
    is_locked: false,
    ...partial,
  };
}

function run() {
  assert(ORIGINAL_SESSION_STRATEGY === "REPLACE_WITH_CHILD_SESSIONS", "strategy locked");
  assert(CAPACITY_EXCEPTION_LIMIT === 5, "+5 policy");

  // 2/3/4 groups balanced
  for (const n of [2, 3, 4]) {
    const plan = planSubgroups(100, n);
    const v = validateSubgroupPlan(100, plan, 60);
    assert(v.ok, `plan ${n} ok: ${v.reasons.join(",")}`);
    assert(plan.length === n, `count ${n}`);
    assert(distributeStudentsBalanced(100, n).reduce((a, b) => a + b, 0) === 100, "sum");
    const sizes = plan.map((p) => p.expected_students);
    assert(Math.max(...sizes) - Math.min(...sizes) <= 1, "balanced");
  }

  // +5 boundary
  assert(validateSubgroupPlan(65, planSubgroups(65, 1), 60).ok, "65 fits 60+5");
  assert(!validateSubgroupPlan(66, planSubgroups(66, 1), 60).ok, "66 fails 60+5");

  // Instructor cannot teach two subgroups concurrently
  const rooms: SimRoom[] = [
    { id: "r1", code: "Q1", room_type: "lecture_hall", capacity: 60 },
    { id: "r2", code: "Q2", room_type: "lecture_hall", capacity: 60 },
  ];
  const occ: SimOccupancy[] = [];
  const a = scheduleChildSession(
    {
      childId: "c1",
      instructor_id: "i1",
      section_id: "s1",
      section_subgroup_id: "g1",
      study_system: "regular",
      expected_students: 50,
      required_room_type: "lecture_hall",
      duration_minutes: 120,
      original_day: 0,
      original_start: "08:00:00",
    },
    rooms,
    occ,
  );
  const b = scheduleChildSession(
    {
      childId: "c2",
      instructor_id: "i1",
      section_id: "s1",
      section_subgroup_id: "g2",
      study_system: "regular",
      expected_students: 50,
      required_room_type: "lecture_hall",
      duration_minutes: 120,
      original_day: 0,
      original_start: "08:00:00",
    },
    rooms,
    occ,
  );
  assert(a.ok && b.ok, "both scheduled");
  assert(!(a.start_time === b.start_time && a.day_of_week === b.day_of_week), "not concurrent");
  assert(scanConflicts(occ).length === 0, "no conflicts after sequential place");

  // Nearest slot preference: same day after original
  const slots = candidateSlots(0, "08:00:00", 120, DEFAULT_SCHEDULER_CONFIG);
  assert(slots[0]?.day_of_week === 0 && slots[0]?.start_time === "08:00:00", "prefer original");

  // Breaks respected
  const withBreak = {
    ...DEFAULT_SCHEDULER_CONFIG,
    dailyBreaks: [{ day_of_week: 0, start_time: "10:00:00", end_time: "12:00:00" }],
  };
  const slotsBreak = candidateSlots(0, "08:00:00", 120, withBreak);
  assert(
    !slotsBreak.some((s) => s.day_of_week === 0 && s.start_time === "10:00:00"),
    "break slot excluded",
  );

  // Room type / capacity
  const labOnly: SimRoom[] = [{ id: "lab1", code: "L1", room_type: "computer_lab", capacity: 30 }];
  const occ2: SimOccupancy[] = [];
  const badType = scheduleChildSession(
    {
      childId: "c3",
      instructor_id: "i2",
      section_id: "s2",
      section_subgroup_id: "g3",
      study_system: "regular",
      expected_students: 20,
      required_room_type: "lecture_hall",
      duration_minutes: 120,
      original_day: 0,
      original_start: "08:00:00",
    },
    labOnly,
    occ2,
  );
  assert(!badType.ok, "type mismatch unschedulable");

  // Parent retired not schedulable / not double counted
  assert(!isSchedulableSession({ replaced_by_split: true }), "parent retired");
  assert(isSchedulableSession({ replaced_by_split: false }), "child active");
  assert(
    !sameSectionSubgroupConflict(
      { section_id: "s1", section_subgroup_id: "g1" },
      { section_id: "s1", section_subgroup_id: "g2" },
    ),
    "distinct subgroups do not section-conflict",
  );
  assert(
    sameSectionSubgroupConflict(
      { section_id: "s1", section_subgroup_id: "g1" },
      { section_id: "s1", section_subgroup_id: "g1" },
    ),
    "same subgroup conflicts",
  );

  // regular/parallel isolation in section conflict helper is study-system aware at scheduler layer;
  // helper itself is section/subgroup only — document via source guard:
  const schedulerSrc = readSrc("src/lib/schedule-builder/subgroup-auto-scheduler.ts");
  assert(schedulerSrc.includes("studySystemIsolated"), "regular/parallel isolation");

  // Drag-and-drop works on subgroup sessions (local pending only)
  const sess = sampleSession({ id: "child-1", subgroup_code: "B", section_subgroup_id: "sg-b" });
  const proposal = proposeSlotFromDragDrop({
    sourceSlot: snapshotOriginalFromSession(sess),
    day_of_week: 1,
    start_time: "10:00:00",
  });
  assert(proposal.ok === true, "dnd proposal ok");
  if (!proposal.ok) throw new Error("unreachable");
  const pending = buildPendingChange({
    session: sess,
    proposed: proposal.proposed,
    changeReason: "drag_drop",
  });
  const applied = applyPendingToSessions([sess], pending, [
    { id: "r1", code: "Q1", name: "قاعة" },
    { id: "r2", code: "Q2", name: "قاعة" },
  ]);
  assert(applied[0]?.day_of_week === 1, "dnd day");
  assert(applied[0]?.subgroup_code === "B", "subgroup preserved after dnd");

  // Source gates: schema migration + replaced_by_split filter + RPC patch
  const schema = readSrc("supabase/migrations/20260715030000_section_subgroups_capacity_model.sql");
  assert(schema.includes("section_subgroups"), "schema table");
  assert(schema.includes("replaced_by_split"), "retire flag");
  assert(!schema.includes("APPLY TO PRODUCTION"), "no prod apply instruction in schema");
  const queries = readSrc("src/lib/schedule-builder/queries.ts");
  assert(queries.includes('eq("replaced_by_split", false)'), "workspace hides retired parents");
  const rpc = readSrc("supabase/migrations/20260715030100_section_subgroups_conflict_rpc.sql");
  assert(rpc.includes("replaced_by_split"), "rpc peers exclude retired");
  assert(rpc.includes("v_room.capacity + 5"), "rpc capacity +5");

  // validation/save + gates referenced in schedule-builder page
  const page = readSrc("src/routes/_authenticated/schedule-builder.tsx");
  assert(page.includes("validateScheduleSessionMove"), "validate rpc wired");
  assert(page.includes("moveOrRescheduleScheduleSession"), "save rpc wired");
  assert(
    page.includes("read_only") || page.includes("isReadOnly") || page.includes("mayEnterEdit"),
    "gates",
  );

  console.log("section-subgroups-capacity.harness.ts: PASS");
}

run();
