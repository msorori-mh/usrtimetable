/**
 * Flexible capacity subgroup model — proposal-only policy harness.
 * No DB writes. Inventory is passed as live room arrays (never hardcoded counts in product code).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPACITY_EXCEPTION_LIMIT,
  ORIGINAL_SESSION_STRATEGY,
  distributeStudentsBalanced,
  isSchedulableSession,
  planSubgroups,
  proposeCapacitySplit,
  sameSectionSubgroupConflict,
  validateSubgroupPlan,
} from "../../src/lib/schedule-builder/section-subgroups";
import {
  evaluateCapacityAgainstRoom,
  showUnverifiedEnrollmentBadge,
  UNVERIFIED_ENROLLMENT_BADGE_AR,
} from "../../src/lib/schedule-builder/enrollment-trust";
import {
  filterRoomsByEligibility,
  preferredRoomTypesForSessionType,
  sessionTypeRequiredRoomTypeConflict,
  summarizeRoomInventory,
} from "../../src/lib/schedule-builder/room-type-policy";
import {
  applyPendingToSessions,
  proposeSlotFromDragDrop,
  snapshotOriginalFromSession,
  buildPendingChange,
  toGridSessionsWithPending,
} from "../../src/lib/schedule-builder/pending-change";
import type { WorkspaceSessionView } from "../../src/lib/schedule-builder/workspace";
import { summarizeConflictExceptions } from "../../src/lib/conflict-engine/exceptions";

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
    enrollment_count_status: "unverified",
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

/** Fixture mirrors owner-stated live inventory shape — product code must not hardcode 14/4. */
function liveInventoryFixture() {
  const halls = Array.from({ length: 14 }, (_, i) => ({
    id: `h${i + 1}`,
    code: `H${i + 1}`,
    room_type: "lecture_hall",
    capacity: 60,
    is_active: true,
  }));
  const labs = Array.from({ length: 4 }, (_, i) => ({
    id: `l${i + 1}`,
    code: `L${i + 1}`,
    room_type: "computer_lab",
    capacity: 30,
    is_active: true,
  }));
  return [...halls, ...labs];
}

function run() {
  assert(ORIGINAL_SESSION_STRATEGY === "REPLACE_WITH_CHILD_SESSIONS", "strategy locked");
  assert(CAPACITY_EXCEPTION_LIMIT === 5, "+5 policy");

  // 1. Live inventory summarized from data — not hardcoded constants in product modules
  const inventory = liveInventoryFixture();
  const inv = summarizeRoomInventory(inventory);
  assert(inv.lectureHallCount === 14, "14 lecture halls from live data");
  assert(inv.labCount === 4, "4 labs from live data");
  assert(
    inv.lectureHallCapacities.every((c) => c === 60),
    "hall capacity 60",
  );
  const productLibs = [
    readSrc("src/lib/schedule-builder/section-subgroups.ts"),
    readSrc("src/lib/schedule-builder/room-type-policy.ts"),
    readSrc("src/lib/schedule-builder/enrollment-trust.ts"),
    readSrc("src/lib/schedule-builder/queries.ts"),
  ].join("\n");
  assert(!productLibs.includes("14 lecture"), "no hardcoded 14 lecture in product");
  assert(!productLibs.includes("NEW-HALL"), "no NEW-HALL in product libs");
  assert(!productLibs.includes("18:00"), "no 18:00 assumption in product libs");

  // 2–3. Room type eligibility from live rooms
  const lectureRooms = filterRoomsByEligibility(inventory, { sessionType: "lecture" });
  assert(
    lectureRooms.every((r) => r.room_type === "lecture_hall") && lectureRooms.length === 14,
    "lecture filters to halls only",
  );
  const labRooms = filterRoomsByEligibility(inventory, { sessionType: "practical" });
  assert(
    labRooms.every((r) => r.room_type === "computer_lab") && labRooms.length === 4,
    "practical filters to labs only",
  );
  assert(preferredRoomTypesForSessionType("lecture")[0] === "lecture_hall", "lecture→hall");
  assert(preferredRoomTypesForSessionType("lab")[0] === "computer_lab", "lab→computer_lab");

  // 4–5. Confirmed capacity +5 / propose split
  const ok65 = evaluateCapacityAgainstRoom({
    enrollmentCount: 65,
    enrollmentStatus: "confirmed",
    roomCapacity: 60,
  });
  assert(ok65.outcome === "ok", "confirmed 65 within +5");
  const over66 = evaluateCapacityAgainstRoom({
    enrollmentCount: 66,
    enrollmentStatus: "confirmed",
    roomCapacity: 60,
  });
  assert(over66.outcome === "hard_block", "confirmed 66 hard block");
  const proposal = proposeCapacitySplit({
    enrollmentCount: 130,
    enrollmentStatus: "confirmed",
    roomCapacity: 60,
  });
  assert(proposal != null && proposal.minimumGroups === 2, "propose 2 groups for 130");
  assert(proposal!.autoCreateForbidden === true, "proposal never auto-creates");
  assert(
    proposeCapacitySplit({
      enrollmentCount: 200,
      enrollmentStatus: "unverified",
      roomCapacity: 60,
    }) == null,
    "unverified never proposes split",
  );

  // 6. Unverified/test = soft warning only
  const soft = evaluateCapacityAgainstRoom({
    enrollmentCount: 200,
    enrollmentStatus: "test",
    roomCapacity: 60,
  });
  assert(soft.outcome === "soft_warning", "test capacity soft");
  const summary = summarizeConflictExceptions([
    { severity: "soft", approved_exception: false },
    { severity: "hard", approved_exception: false },
  ]);
  assert(summary.unapprovedHardConflicts === 1, "soft excluded from hard count");

  // 7–8. No auto subgroup/session creation in schema/data migrations
  const schema = readSrc("supabase/migrations/20260715030000_section_subgroups_capacity_model.sql");
  assert(schema.includes("section_subgroups"), "schema table retained");
  assert(schema.includes("enrollment_count_status"), "trust column");
  assert(!schema.includes("INSERT INTO public.section_subgroups"), "no subgroup data apply");
  assert(!schema.includes("INSERT INTO public.schedule_sessions"), "no session data apply");
  assert(
    !readdirSync(join(root, "supabase/migrations")).some((f) => f.includes("data_apply")),
    "data_apply migration removed",
  );
  assert(
    !existsSync(
      join(root, "supabase/migrations/20260715030200_section_subgroups_data_apply_deferred.sql"),
    ),
    "deferred data-apply file deleted",
  );

  // 9–10. No operating-hours / NEW-* creation in migrations
  const rpc = readSrc("supabase/migrations/20260715030100_section_subgroups_conflict_rpc.sql");
  assert(rpc.includes("enrollment_count_status"), "rpc trust-aware");
  assert(rpc.includes("room_capacity_unverified"), "rpc soft capacity");
  assert(!rpc.includes("NEW-HALL"), "rpc no temp rooms");
  assert(!rpc.includes("UPDATE scheduling_settings"), "rpc does not rewrite operating hours");
  assert(!rpc.includes("18:00"), "rpc no 18:00 extension");

  // Balanced plan helpers still work for confirmed proposals
  for (const n of [2, 3, 4]) {
    const plan = planSubgroups(100, n);
    assert(validateSubgroupPlan(100, plan, 60).ok, `plan ${n}`);
    assert(distributeStudentsBalanced(100, n).reduce((a, b) => a + b, 0) === 100, "sum");
  }

  // Data quality warning path (no auto-correct)
  const dq = sessionTypeRequiredRoomTypeConflict({
    sessionType: "lecture",
    requiredRoomType: "computer_lab",
  });
  assert(dq.conflict === true, "session/required mismatch flagged");

  // Parent/child schedulability + subgroup conflicts
  assert(!isSchedulableSession({ replaced_by_split: true }), "parent retired");
  assert(
    !sameSectionSubgroupConflict(
      { section_id: "s1", section_subgroup_id: "g1" },
      { section_id: "s1", section_subgroup_id: "g2" },
    ),
    "distinct subgroups ok",
  );

  // 11. Drag-and-drop pending-only
  const sess = sampleSession({ id: "child-1", subgroup_code: "B", section_subgroup_id: "sg-b" });
  const proposalDnD = proposeSlotFromDragDrop({
    sourceSlot: snapshotOriginalFromSession(sess),
    day_of_week: 1,
    start_time: "10:00:00",
  });
  assert(proposalDnD.ok === true, "dnd proposal ok");
  if (!proposalDnD.ok) throw new Error("unreachable");
  const pending = buildPendingChange({
    session: sess,
    proposed: proposalDnD.proposed,
    changeReason: "drag_drop",
  });
  const applied = applyPendingToSessions([sess], pending, [
    { id: "r1", code: "Q1", name: "قاعة" },
    { id: "r2", code: "Q2", name: "قاعة" },
  ]);
  assert(applied[0]?.day_of_week === 1, "dnd day");
  assert(applied[0]?.subgroup_code === "B", "subgroup preserved");
  assert(applied[0]?.enrollment_count_status === "unverified", "trust preserved");

  // 6b. Badge for unverified
  assert(showUnverifiedEnrollmentBadge("test"), "badge for test");
  const grid = toGridSessionsWithPending([sess], null, null);
  assert(grid[0]?.badge?.includes(UNVERIFIED_ENROLLMENT_BADGE_AR), "grid badge unverified");

  // 12–14. RPC save wiring + gates + no PGRST200 embeds
  const page = readSrc("src/routes/_authenticated/schedule-builder.tsx");
  assert(page.includes("validateScheduleSessionMove"), "validate rpc");
  assert(page.includes("moveOrRescheduleScheduleSession"), "save rpc");
  assert(
    page.includes("read_only") || page.includes("isReadOnly") || page.includes("mayEnterEdit"),
    "gates",
  );
  const queries = readSrc("src/lib/schedule-builder/queries.ts");
  assert(queries.includes('eq("replaced_by_split", false)'), "hides retired parents");
  assert(queries.includes("PGRST200") || queries.includes("no PostgREST embeds"), "no embed path");
  assert(!queries.includes("schedule_sessions("), "no nested session embeds");

  // Simulation script superseded
  const sim = readSrc("scripts/phase6-subgroup-simulation.mjs");
  assert(sim.includes("SUPERSEDED_BY_OWNER_DATA_POLICY"), "sim superseded");
  assert(sim.includes("process.exit(2)"), "sim exits");

  console.log("section-subgroups-capacity.harness.ts: PASS");
}

run();
