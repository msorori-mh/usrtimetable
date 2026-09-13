import { supabase } from "@/integrations/supabase/client";
import {
  validateProposed,
  type ProposedSession,
  type StudySystem,
} from "@/lib/conflict-engine/validator";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";
import { isPracticalLabFallback, roomTypeRank } from "@/lib/scheduling/room-type-policy";

export interface UnplacedItem {
  course_offering_id: string;
  teaching_assignment_id: string | null;
  instructor_id: string;
  course_id: string | null;
  session_type: string;
  duration_minutes: number;
  unit_index: number;
  reason: string;
}

export type AutoRunMode = "fill_missing" | "regenerate_auto" | "full_rebuild";

export interface AutoRunResult {
  runId: string;
  placed: number;
  unplaced: UnplacedItem[];
  totalRequired: number;
  byType: Record<string, { required: number; placed: number; unplaced: number }>;
  warnings: string[];
  hardConflictsAfter: number;
  softViolationsAfter: number;
  qualityScoreBefore: number;
  qualityScoreAfter: number;
  improvementDelta: number;
  preservedExistingSessions: number;
  relocatedSessions: number;
  backtrackingAttempts: number;
  durationMs: number;
  totalOfferings: number;
  mode: AutoRunMode;
  deletedAutoSessions: number;
  skippedLockedSessions: number;
  /** Practical sessions placed in a lecture hall via the allowed room fallback. */
  practicalRoomFallbacks?: number;
}

const ALGORITHM_VERSION = "greedy-v2-difficulty-backtrack";
const ORDERING_STRATEGY = "difficulty:rooms,slots,students,roomtype,duration";
const MAX_BACKTRACKING_ATTEMPTS = 50;

const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;
const t = (s: string) => (s.length === 5 ? `${s}:00` : s);

interface CandidateSlot {
  day: number;
  start: string;
  end: string;
}

interface SessionUnit {
  ta_id: string;
  course_offering_id: string;
  instructor_id: string;
  section_id: string | null;
  course_id: string;
  expected_students: number;
  study_system: StudySystem;
  session_type: "lecture" | "lab";
  duration_min: number;
  required_room_type: string | null;
  unit_index: number;
  // computed difficulty inputs
  candidate_room_count: number;
  candidate_slot_count: number;
}

interface PrefRow {
  instructor_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  availability_type: string | null;
}

/**
 * Greedy auto-placer V2 (Phase 8B).
 * Improvements over V1.1:
 *  - Difficulty-based ordering of session units (hardest first).
 *  - Candidate scoring (capacity match + instructor preferences).
 *  - Limited backtracking: relocate previously placed (this-run) sessions to free slots.
 *  - Preserve all pre-existing sessions; never delete or overwrite them.
 *  - Run summary extended with algorithm_version, ordering_strategy, quality_before/after, etc.
 */
export async function runGreedyAutoSchedule(params: {
  collegeId: string;
  scheduleVersionId: string;
  mode?: AutoRunMode;
}): Promise<AutoRunResult> {
  const { collegeId, scheduleVersionId } = params;
  const mode: AutoRunMode = params.mode ?? "fill_missing";
  let deletedAutoSessions = 0;
  let skippedLockedSessions = 0;
  const t0 = performance.now();
  const warnings: string[] = [];

  // 1. Quality BEFORE
  const { result: qBefore } = await scoreScheduleVersion({
    collegeId,
    scheduleVersionId,
    persist: false,
  });

  // 2. Scheduling settings (fallback windows)
  const { data: settingsRow, error: settingsError } = await supabase
    .from("scheduling_settings")
    .select("*")
    .eq("college_id", collegeId)
    .maybeSingle();
  if (settingsError)
    throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[scheduling_settings]: ${settingsError.message}`);
  const workingDays: number[] = settingsRow?.working_days ?? [6, 0, 1, 2, 3, 4];
  const dayStart = (settingsRow?.day_start_time ?? "08:00:00") as string;
  const dayEnd = (settingsRow?.day_end_time ?? "14:00:00") as string;
  const slotMin = settingsRow?.slot_minutes ?? 60;
  const minH = Number(settingsRow?.min_session_hours ?? 1);
  const maxH = Number(settingsRow?.max_session_hours ?? 4);

  // 3. Time-slot templates
  const { data: templates, error: templatesError } = await supabase
    .from("time_slot_templates")
    .select("study_system, day_of_week, start_time, end_time")
    .eq("college_id", collegeId)
    .eq("is_active", true);
  if (templatesError)
    throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[time_slot_templates]: ${templatesError.message}`);

  // 4. Apply destructive mode actions BEFORE reading existing sessions.
  // Locked sessions are NEVER touched (DB trigger also blocks deletion).
  if (mode === "regenerate_auto") {
    const { data: del, error: deleteError } = await supabase
      .from("schedule_sessions")
      .delete()
      .eq("college_id", collegeId)
      .eq("schedule_version_id", scheduleVersionId)
      .eq("source_type", "auto_generated")
      .eq("is_locked", false)
      .select("id");
    if (deleteError) throw new Error(`AUTO_SCHEDULE_DELETE_FAILED: ${deleteError.message}`);
    deletedAutoSessions = (del ?? []).length;
  } else if (mode === "full_rebuild") {
    // Aggressive: remove all unlocked sessions (auto + manual). Locked stays.
    const { data: del, error: deleteError } = await supabase
      .from("schedule_sessions")
      .delete()
      .eq("college_id", collegeId)
      .eq("schedule_version_id", scheduleVersionId)
      .eq("is_locked", false)
      .select("id, source_type");
    if (deleteError) throw new Error(`AUTO_SCHEDULE_DELETE_FAILED: ${deleteError.message}`);
    deletedAutoSessions = (del ?? []).filter((r) => r.source_type === "auto_generated").length;
    if ((del ?? []).length > deletedAutoSessions) {
      warnings.push(
        `full_rebuild: deleted ${(del ?? []).length - deletedAutoSessions} manual unlocked session(s)`,
      );
    }
  }

  // Existing sessions — preserved (we will not touch these)
  const { data: existingSessions, error: existingSessionsError } = await supabase
    .from("schedule_sessions")
    .select("id, teaching_assignment_id, session_type, is_locked, source_type")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", scheduleVersionId);
  if (existingSessionsError) {
    throw new Error(
      `AUTO_SCHEDULE_QUERY_FAILED[schedule_sessions]: ${existingSessionsError.message}`,
    );
  }
  const preservedExistingSessions = (existingSessions ?? []).length;
  skippedLockedSessions = (existingSessions ?? []).filter((s) => s.is_locked).length;
  const preservedIds = new Set((existingSessions ?? []).map((s) => s.id));
  const lockedIds = new Set((existingSessions ?? []).filter((s) => s.is_locked).map((s) => s.id));
  const existingCount = new Map<string, number>();
  for (const s of existingSessions ?? []) {
    if (!s.teaching_assignment_id) continue;
    const k = `${s.teaching_assignment_id}|${s.session_type}`;
    existingCount.set(k, (existingCount.get(k) ?? 0) + 1);
  }

  // 5. Offerings / TAs / courses / plan_courses / depts
  const { data: offerings, error: offeringsError } = await supabase
    .from("course_offerings")
    .select("id, course_id, expected_students, college_id, study_plan_id, plan_course_id")
    .eq("college_id", collegeId)
    .eq("is_active", true);
  if (offeringsError)
    throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[course_offerings]: ${offeringsError.message}`);
  const totalOfferings = (offerings ?? []).length;
  const offeringIds = (offerings ?? []).map((o) => o.id);

  const { data: tas, error: tasError } = offeringIds.length
    ? await supabase
        .from("teaching_assignments")
        .select(
          "id, course_offering_id, instructor_id, session_type, weekly_hours, required_room_type, expected_students, section_id",
        )
        .in("course_offering_id", offeringIds)
    : { data: [], error: null };
  if (tasError)
    throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[teaching_assignments]: ${tasError.message}`);

  const courseIds = Array.from(new Set((offerings ?? []).map((o) => o.course_id)));
  const { data: courses, error: coursesError } = courseIds.length
    ? await supabase.from("courses").select("id, department_id").in("id", courseIds)
    : { data: [], error: null };
  if (coursesError) throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[courses]: ${coursesError.message}`);
  const depIds = Array.from(
    new Set((courses ?? []).map((c) => c.department_id).filter(Boolean) as string[]),
  );
  const { data: deps, error: depsError } = depIds.length
    ? await supabase.from("departments").select("id, study_system").in("id", depIds)
    : { data: [], error: null };
  if (depsError) throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[departments]: ${depsError.message}`);
  const depSystem = new Map((deps ?? []).map((d) => [d.id, d.study_system as StudySystem]));
  const courseDep = new Map((courses ?? []).map((c) => [c.id, c.department_id as string | null]));
  const offMap = new Map((offerings ?? []).map((o) => [o.id, o]));

  const planCourseIds = Array.from(
    new Set((offerings ?? []).map((o) => o.plan_course_id).filter(Boolean) as string[]),
  );
  const { data: pcsById, error: pcsByIdError } = planCourseIds.length
    ? await supabase
        .from("plan_courses")
        .select(
          "id, study_plan_id, course_id, lectures_per_week, lecture_session_duration, labs_per_week, lab_session_duration, required_room_type_for_lecture, required_room_type_for_lab",
        )
        .in("id", planCourseIds)
    : { data: [], error: null };
  if (pcsByIdError)
    throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[plan_courses]: ${pcsByIdError.message}`);
  const pcById = new Map((pcsById ?? []).map((p) => [p.id, p]));

  const planIds = Array.from(
    new Set((offerings ?? []).map((o) => o.study_plan_id).filter(Boolean) as string[]),
  );
  const { data: pcsByPlan, error: pcsByPlanError } = planIds.length
    ? await supabase
        .from("plan_courses")
        .select(
          "id, study_plan_id, course_id, lectures_per_week, lecture_session_duration, labs_per_week, lab_session_duration, required_room_type_for_lecture, required_room_type_for_lab",
        )
        .in("study_plan_id", planIds)
    : { data: [], error: null };
  if (pcsByPlanError)
    throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[plan_courses]: ${pcsByPlanError.message}`);
  const pcByPlanCourse = new Map(
    (pcsByPlan ?? []).map((p) => [`${p.study_plan_id}|${p.course_id}`, p]),
  );

  // 6. Rooms
  const { data: rooms, error: roomsError } = await supabase
    .from("rooms")
    .select("id, capacity, room_type")
    .eq("college_id", collegeId);
  if (roomsError) throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[rooms]: ${roomsError.message}`);
  const allRooms = rooms ?? [];

  // 7. Instructor preferences (soft) — for candidate scoring
  const instructorIds = Array.from(new Set((tas ?? []).map((ta) => ta.instructor_id)));
  const { data: prefData, error: prefError } = instructorIds.length
    ? await supabase
        .from("instructor_availability")
        .select(
          "instructor_id, day_of_week, start_time, end_time, availability_type, is_preference",
        )
        .in("instructor_id", instructorIds)
        .eq("is_preference", true)
    : { data: [], error: null };
  if (prefError)
    throw new Error(`AUTO_SCHEDULE_QUERY_FAILED[instructor_availability]: ${prefError.message}`);
  const prefsByInstr = new Map<string, PrefRow[]>();
  for (const p of (prefData ?? []) as PrefRow[]) {
    const arr = prefsByInstr.get(p.instructor_id) ?? [];
    arr.push(p);
    prefsByInstr.set(p.instructor_id, arr);
  }

  // Helpers
  const clampDuration = (h: number): number => {
    const hh = Math.min(maxH, Math.max(minH, h > 0 ? h : minH));
    return Math.round(hh * 60);
  };
  const isLecLike = (st: string | null | undefined) =>
    !st || ["lecture", "lec", "نظري", "محاضرة"].includes(st);
  const isLabLike = (st: string | null | undefined) =>
    !!st && ["lab", "practical", "عملي", "معمل"].includes(st);

  const buildCandidates = (system: StudySystem, durationMin: number): CandidateSlot[] => {
    const out: CandidateSlot[] = [];
    const tpls = (templates ?? []).filter(
      (tp) => tp.study_system === system || tp.study_system === "both" || system === "both",
    );
    if (tpls.length > 0) {
      for (const tp of tpls) {
        const ws = toMin(tp.start_time);
        const we = toMin(tp.end_time);
        for (let s = ws; s + durationMin <= we; s += slotMin) {
          out.push({ day: tp.day_of_week, start: fromMin(s), end: fromMin(s + durationMin) });
        }
      }
    } else {
      const ws = toMin(dayStart);
      const we = toMin(dayEnd);
      for (const d of workingDays) {
        for (let s = ws; s + durationMin <= we; s += slotMin) {
          out.push({ day: d, start: fromMin(s), end: fromMin(s + durationMin) });
        }
      }
    }
    out.sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start));
    return out;
  };

  const roomPoolFor = (
    requiredType: string | null,
    expected: number,
    componentType?: string | null,
  ) => {
    // Practical components requiring computer_lab may use lecture_hall as a
    // ranked fallback (labs first); every other type stays an exact match.
    const filtered = allRooms
      .map((r) => ({
        room: r,
        rank: roomTypeRank({
          componentType,
          requiredRoomType: requiredType,
          roomType: r.room_type,
        }),
      }))
      .filter((entry) => entry.rank !== null)
      .filter((entry) => (expected > 0 ? entry.room.capacity >= expected : true))
      .sort((a, b) => a.rank! - b.rank! || a.room.capacity - b.room.capacity)
      .map((entry) => entry.room);
    if (requiredType) return filtered;
    return filtered.length > 0
      ? filtered
      : allRooms
          .filter((r) => (expected > 0 ? r.capacity >= expected : true))
          .sort((a, b) => a.capacity - b.capacity);
  };

  // Score a (slot, room) candidate. Higher is better.
  const scoreCandidate = (
    unit: SessionUnit,
    slot: CandidateSlot,
    room: { id: string; capacity: number; room_type: string | null },
  ): number => {
    let score = 0;
    // Capacity fit: prefer smallest sufficient room (penalize waste)
    if (unit.expected_students > 0) {
      const waste = Math.max(0, room.capacity - unit.expected_students);
      score -= waste * 0.05;
    }
    // Room type match exact
    if (unit.required_room_type && room.room_type === unit.required_room_type) score += 2;
    // A policy fallback room must never outrank the required room type.
    else if (
      isPracticalLabFallback({
        componentType: unit.session_type,
        requiredRoomType: unit.required_room_type,
        roomType: room.room_type,
      })
    )
      score -= 3;
    // Instructor preferences
    const prefs = (prefsByInstr.get(unit.instructor_id) ?? []).filter(
      (p) => p.day_of_week === slot.day,
    );
    if (prefs.length > 0) {
      const wanted = prefs.filter((p) => p.availability_type !== "unavailable");
      const blocked = prefs.filter((p) => p.availability_type === "unavailable");
      const fits =
        wanted.length === 0 ||
        wanted.some((w) => t(slot.start) >= t(w.start_time) && t(slot.end) <= t(w.end_time));
      const hitsBlocked = blocked.some(
        (w) => t(slot.start) < t(w.end_time) && t(w.start_time) < t(slot.end),
      );
      if (fits && !hitsBlocked) score += 5;
      if (hitsBlocked) score -= 10;
      if (!fits) score -= 3;
    }
    // Prefer mornings (small tie-break)
    score -= toMin(slot.start) * 0.0005;
    return score;
  };

  // 8. Build units for every TA
  const buildUnits = (ta: NonNullable<typeof tas>[number]): SessionUnit[] => {
    const off = offMap.get(ta.course_offering_id);
    if (!off) return [];
    const sys = depSystem.get(courseDep.get(off.course_id) ?? "") ?? "regular";
    const expected = ta.expected_students || off.expected_students || 0;

    const pc =
      (off.plan_course_id ? pcById.get(off.plan_course_id) : undefined) ??
      (off.study_plan_id ? pcByPlanCourse.get(`${off.study_plan_id}|${off.course_id}`) : undefined);

    const out: SessionUnit[] = [];
    const taType = (ta.session_type ?? "lecture").toLowerCase();
    const mkUnit = (
      session_type: "lecture" | "lab",
      duration_min: number,
      required_room_type: string | null,
      unit_index: number,
    ): SessionUnit => ({
      ta_id: ta.id,
      course_offering_id: ta.course_offering_id,
      instructor_id: ta.instructor_id,
      section_id: ta.section_id ?? null,
      course_id: off.course_id,
      expected_students: expected,
      study_system: sys,
      session_type,
      duration_min,
      required_room_type,
      unit_index,
      candidate_room_count: 0,
      candidate_slot_count: 0,
    });

    if (!pc) {
      warnings.push(
        `no plan_courses pattern for offering ${off.id} — fallback single session for TA ${ta.id}`,
      );
      out.push(
        mkUnit(
          isLabLike(taType) ? "lab" : "lecture",
          clampDuration(Number(ta.weekly_hours ?? 0)),
          ta.required_room_type ?? null,
          1,
        ),
      );
      return out;
    }
    const wantLec = isLecLike(taType) || taType === "both" || taType === "mixed";
    const wantLab = isLabLike(taType) || taType === "both" || taType === "mixed";
    if (wantLec) {
      const n = Number(pc.lectures_per_week ?? 0);
      const dh = Number(pc.lecture_session_duration ?? 0);
      for (let i = 1; i <= n; i++) {
        out.push(
          mkUnit(
            "lecture",
            clampDuration(dh),
            pc.required_room_type_for_lecture ?? ta.required_room_type ?? null,
            i,
          ),
        );
      }
    }
    if (wantLab) {
      const n = Number(pc.labs_per_week ?? 0);
      const dh = Number(pc.lab_session_duration ?? 0);
      for (let i = 1; i <= n; i++) {
        out.push(
          mkUnit(
            "lab",
            clampDuration(dh),
            pc.required_room_type_for_lab ?? ta.required_room_type ?? null,
            i,
          ),
        );
      }
    }
    if (out.length === 0) {
      warnings.push(`plan_courses pattern has zero sessions for offering ${off.id} — fallback`);
      out.push(
        mkUnit(
          isLabLike(taType) ? "lab" : "lecture",
          clampDuration(Number(ta.weekly_hours ?? 0)),
          ta.required_room_type ?? null,
          1,
        ),
      );
    }
    return out;
  };

  // Build the full unit pool, subtract already-placed per (ta, session_type)
  const allUnits: SessionUnit[] = [];
  for (const ta of tas ?? []) {
    const units = buildUnits(ta);
    const placedPerType: Record<string, number> = {};
    for (const u of units) {
      const already = existingCount.get(`${ta.id}|${u.session_type}`) ?? 0;
      const doneSoFar = placedPerType[u.session_type] ?? 0;
      if (doneSoFar < already) {
        placedPerType[u.session_type] = doneSoFar + 1;
      } else {
        allUnits.push(u);
      }
    }
  }

  // 9. Difficulty ordering — annotate candidate counts then sort
  for (const u of allUnits) {
    u.candidate_room_count = roomPoolFor(u.required_room_type, u.expected_students, u.session_type).length;
    u.candidate_slot_count = buildCandidates(u.study_system, u.duration_min).length;
  }
  // Hardest first: fewer rooms, fewer slots, larger students, stricter type, longer duration
  allUnits.sort((a, b) => {
    if (a.candidate_room_count !== b.candidate_room_count)
      return a.candidate_room_count - b.candidate_room_count;
    if (a.candidate_slot_count !== b.candidate_slot_count)
      return a.candidate_slot_count - b.candidate_slot_count;
    if (a.expected_students !== b.expected_students)
      return b.expected_students - a.expected_students;
    const rt = (a.required_room_type ? 1 : 0) - (b.required_room_type ? 1 : 0);
    if (rt !== 0) return -rt;
    if (a.duration_min !== b.duration_min) return b.duration_min - a.duration_min;
    return 0;
  });

  // 10. Place units (with limited backtracking)
  const unplaced: UnplacedItem[] = [];
  let placed = 0;
  const totalRequired = allUnits.length;
  const byType: Record<string, { required: number; placed: number; unplaced: number }> = {};
  const bump = (type: string, field: "required" | "placed" | "unplaced") => {
    if (!byType[type]) byType[type] = { required: 0, placed: 0, unplaced: 0 };
    byType[type][field]++;
  };
  for (const u of allUnits) bump(u.session_type, "required");

  // Track which sessions were placed by THIS run (relocatable)
  const placedThisRun = new Map<string, SessionUnit>();
  let backtrackingAttempts = 0;
  let relocatedSessions = 0;

  // Helper: try to insert proposed session; returns id on success, null on failure
  const insertProposed = async (proposed: ProposedSession): Promise<string> => {
    const { data, error } = await supabase
      .from("schedule_sessions")
      .insert({
        college_id: collegeId,
        schedule_version_id: scheduleVersionId,
        course_offering_id: proposed.course_offering_id,
        teaching_assignment_id: proposed.teaching_assignment_id,
        instructor_id: proposed.instructor_id,
        room_id: proposed.room_id,
        section_id: proposed.section_id,
        study_system: proposed.study_system,
        day_of_week: proposed.day_of_week,
        start_time: proposed.start_time,
        end_time: proposed.end_time,
        session_type: proposed.session_type ?? "lecture",
        expected_students: proposed.expected_students ?? 0,
        source_type: "auto_generated",
      })
      .select("id")
      .single();
    if (error) throw new Error(`AUTO_SCHEDULE_INSERT_FAILED: ${error.message}`);
    if (!data) throw new Error("AUTO_SCHEDULE_INSERT_FAILED: no inserted row returned");
    return data.id;
  };

  // Build & rank candidate (slot, room) tuples for a unit
  const buildRankedCandidates = (unit: SessionUnit) => {
    const slots = buildCandidates(unit.study_system, unit.duration_min);
    const roomPool = roomPoolFor(unit.required_room_type, unit.expected_students, unit.session_type);
    const tuples: Array<{
      slot: CandidateSlot;
      room: { id: string; capacity: number; room_type: string | null };
      score: number;
    }> = [];
    for (const slot of slots) {
      for (const room of roomPool) {
        tuples.push({ slot, room, score: scoreCandidate(unit, slot, room) });
      }
    }
    tuples.sort((a, b) => b.score - a.score);
    return tuples;
  };

  // Try place a single unit. Returns true if placed.
  const tryPlace = async (
    unit: SessionUnit,
    allowBacktrack: boolean,
  ): Promise<{ ok: boolean; reason: string }> => {
    const candidates = buildRankedCandidates(unit);
    let lastReason = unit.required_room_type
      ? `لا تتوفر قاعة من النوع المطلوب (${unit.required_room_type}) أو فترة زمنية مناسبة`
      : "لا تتوفر فترة زمنية أو قاعة مناسبة";
    if (candidates.length === 0) lastReason = "لا توجد قاعات أو فترات متاحة في الكلية";

    // Pass 1: try without backtracking
    for (const c of candidates) {
      const proposed: ProposedSession = {
        course_offering_id: unit.course_offering_id,
        teaching_assignment_id: unit.ta_id,
        instructor_id: unit.instructor_id,
        room_id: c.room.id,
        section_id: unit.section_id,
        study_system: unit.study_system,
        day_of_week: c.slot.day,
        start_time: c.slot.start,
        end_time: c.slot.end,
        session_type: unit.session_type,
        expected_students: unit.expected_students,
      };
      const validation = await validateProposed({
        collegeId,
        scheduleVersionId,
        sessions: [proposed],
      });
      if (validation.unapprovedHardConflicts === 0) {
        const id = await insertProposed(proposed);
        placedThisRun.set(id, unit);
        return { ok: true, reason: "" };
      } else {
        lastReason = validation.conflicts[0].message_ar;
      }
    }

    if (!allowBacktrack) return { ok: false, reason: lastReason };

    // Pass 2: limited backtracking — try to relocate ONE this-run session blocking each candidate
    for (const c of candidates) {
      if (backtrackingAttempts >= MAX_BACKTRACKING_ATTEMPTS) break;
      const proposed: ProposedSession = {
        course_offering_id: unit.course_offering_id,
        teaching_assignment_id: unit.ta_id,
        instructor_id: unit.instructor_id,
        room_id: c.room.id,
        section_id: unit.section_id,
        study_system: unit.study_system,
        day_of_week: c.slot.day,
        start_time: c.slot.start,
        end_time: c.slot.end,
        session_type: unit.session_type,
        expected_students: unit.expected_students,
      };
      // Identify candidate blockers among this-run placed sessions
      for (const [blockerId, blockerUnit] of placedThisRun) {
        if (preservedIds.has(blockerId)) continue; // safety
        if (lockedIds.has(blockerId)) continue; // never touch locked
        if (backtrackingAttempts >= MAX_BACKTRACKING_ATTEMPTS) break;
        // Test: would removing this blocker free the candidate?
        const validation = await validateProposed({
          collegeId,
          scheduleVersionId,
          sessions: [proposed],
          excludeExistingSessionIds: [blockerId],
        });
        if (validation.unapprovedHardConflicts !== 0) continue;
        backtrackingAttempts++;
        // Delete the blocker
        const { error: de } = await supabase.from("schedule_sessions").delete().eq("id", blockerId);
        if (de) continue;
        placedThisRun.delete(blockerId);
        // Insert the new unit in the freed slot
        const newId = await insertProposed(proposed);
        if (!newId) {
          // restore — best effort by re-running placement of blocker later
          warnings.push(`backtrack insert failed; blocker ${blockerId.slice(0, 8)} lost`);
          return { ok: false, reason: "backtrack insert failed" };
        }
        placedThisRun.set(newId, unit);
        relocatedSessions++;
        // Try to re-place the displaced blocker unit (no further backtracking to avoid cascades)
        const re = await tryPlace(blockerUnit, false);
        if (!re.ok) {
          // Displaced blocker couldn't be re-placed; record it as unplaced and continue.
          bump(blockerUnit.session_type, "unplaced");
          unplaced.push({
            course_offering_id: blockerUnit.course_offering_id,
            teaching_assignment_id: blockerUnit.ta_id,
            instructor_id: blockerUnit.instructor_id,
            course_id: blockerUnit.course_id,
            session_type: blockerUnit.session_type,
            duration_minutes: blockerUnit.duration_min,
            unit_index: blockerUnit.unit_index,
            reason: `أُزيلت أثناء التراجع المحدود ولم تُعد جدولتها: ${re.reason}`,
          });
          // Decrement placed since we earlier counted it
          placed -= 1;
          if (byType[blockerUnit.session_type]) byType[blockerUnit.session_type].placed -= 1;
        }
        return { ok: true, reason: "" };
      }
    }
    return { ok: false, reason: lastReason };
  };

  for (const unit of allUnits) {
    const res = await tryPlace(unit, true);
    if (res.ok) {
      placed++;
      bump(unit.session_type, "placed");
    } else {
      bump(unit.session_type, "unplaced");
      unplaced.push({
        course_offering_id: unit.course_offering_id,
        teaching_assignment_id: unit.ta_id,
        instructor_id: unit.instructor_id,
        course_id: unit.course_id,
        session_type: unit.session_type,
        duration_minutes: unit.duration_min,
        unit_index: unit.unit_index,
        reason: res.reason,
      });
    }
  }

  // 11. Quality AFTER
  const { result: qAfter } = await scoreScheduleVersion({
    collegeId,
    scheduleVersionId,
    persist: false,
  });

  const durationMs = Math.round(performance.now() - t0);
  const { data: userData } = await supabase.auth.getUser();
  const improvementDelta = (qAfter.total_score ?? 0) - (qBefore.total_score ?? 0);

  const { data: row, error } = await supabase
    .from("auto_schedule_runs")
    .insert({
      college_id: collegeId,
      schedule_version_id: scheduleVersionId,
      algorithm: "greedy",
      status: unplaced.length === 0 ? "completed" : "partial",
      total_offerings: totalOfferings,
      placed_sessions: placed,
      unplaced_sessions: unplaced.length,
      hard_conflicts_after: qAfter.hard_conflicts_count,
      soft_violations_after: qAfter.soft_conflicts_count,
      quality_score_after: qAfter.total_score,
      duration_ms: durationMs,
      summary: {
        algorithm_version: ALGORITHM_VERSION,
        ordering_strategy: ORDERING_STRATEGY,
        mode,
        max_backtracking_attempts: MAX_BACKTRACKING_ATTEMPTS,
        backtracking_attempts: backtrackingAttempts,
        relocated_sessions: relocatedSessions,
        preserved_existing_sessions: preservedExistingSessions,
        deleted_auto_sessions: deletedAutoSessions,
        skipped_locked_sessions: skippedLockedSessions,
        regenerated_sessions: mode === "fill_missing" ? 0 : placed,
        quality_before: qBefore.total_score,
        quality_after: qAfter.total_score,
        improvement_delta: improvementDelta,
        total_required_sessions: totalRequired,
        by_session_type: byType,
        warnings: warnings.slice(0, 50),
        breakdown: qAfter.metrics_breakdown,
      } as never,
      unplaced: unplaced as never,
      run_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;

  // Back-fill auto_schedule_run_id on sessions placed by this run
  const placedIds = Array.from(placedThisRun.keys());
  if (placedIds.length > 0) {
    await supabase
      .from("schedule_sessions")
      .update({ auto_schedule_run_id: row.id })
      .in("id", placedIds);
  }

  return {
    runId: row.id,
    placed,
    unplaced,
    totalRequired,
    byType,
    warnings,
    hardConflictsAfter: qAfter.hard_conflicts_count,
    softViolationsAfter: qAfter.soft_conflicts_count,
    qualityScoreBefore: qBefore.total_score,
    qualityScoreAfter: qAfter.total_score,
    improvementDelta,
    preservedExistingSessions,
    relocatedSessions,
    backtrackingAttempts,
    durationMs,
    totalOfferings,
    mode,
    deletedAutoSessions,
    skippedLockedSessions,
  };
}
