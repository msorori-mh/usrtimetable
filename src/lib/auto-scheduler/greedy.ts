import { supabase } from "@/integrations/supabase/client";
import { validateProposed, type ProposedSession, type StudySystem } from "@/lib/conflict-engine/validator";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";

export interface AutoRunResult {
  runId: string;
  placed: number;
  unplaced: Array<{
    course_offering_id: string;
    teaching_assignment_id: string | null;
    instructor_id: string;
    session_type: string;
    reason: string;
  }>;
  hardConflictsAfter: number;
  softViolationsAfter: number;
  qualityScoreAfter: number;
  durationMs: number;
  totalOfferings: number;
}

const pad = (n: number) => String(n).padStart(2, "0");
const toMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`;

interface CandidateSlot {
  day: number;
  start: string;
  end: string;
}

/**
 * Greedy auto-placer (V1).
 * - Scans course_offerings in the version that have no schedule_sessions yet.
 * - For each teaching_assignment of that offering, creates ONE session matching weekly_hours
 *   (clamped by scheduling_settings min/max duration).
 * - Picks the first (day, start, room) combination that passes hard-conflict validation.
 * - Persists sessions one-by-one so each placement sees prior placements as peers.
 */
export async function runGreedyAutoSchedule(params: {
  collegeId: string;
  scheduleVersionId: string;
}): Promise<AutoRunResult> {
  const { collegeId, scheduleVersionId } = params;
  const t0 = performance.now();

  // 1. Load scheduling settings (fallback windows)
  const { data: settingsRow } = await supabase
    .from("scheduling_settings")
    .select("*")
    .eq("college_id", collegeId)
    .maybeSingle();
  const workingDays: number[] = settingsRow?.working_days ?? [6, 0, 1, 2, 3, 4];
  const dayStart = (settingsRow?.day_start_time ?? "08:00:00") as string;
  const dayEnd = (settingsRow?.day_end_time ?? "14:00:00") as string;
  const slotMin = settingsRow?.slot_minutes ?? 60;
  const minH = Number(settingsRow?.min_session_hours ?? 1);
  const maxH = Number(settingsRow?.max_session_hours ?? 3);

  // 2. Load time-slot templates (per study_system + day) — used as candidate windows
  const { data: templates } = await supabase
    .from("time_slot_templates")
    .select("study_system, day_of_week, start_time, end_time")
    .eq("college_id", collegeId)
    .eq("is_active", true);

  // 3. Find unscheduled offerings
  const { data: existingSessions } = await supabase
    .from("schedule_sessions")
    .select("course_offering_id, teaching_assignment_id")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", scheduleVersionId);
  const scheduledTAs = new Set<string>(
    (existingSessions ?? [])
      .map((s) => s.teaching_assignment_id)
      .filter(Boolean) as string[],
  );

  const { data: offerings } = await supabase
    .from("course_offerings")
    .select("id, course_id, expected_students, college_id")
    .eq("college_id", collegeId)
    .eq("is_active", true);
  const totalOfferings = (offerings ?? []).length;

  const offeringIds = (offerings ?? []).map((o) => o.id);
  const { data: tas } = offeringIds.length
    ? await supabase
        .from("teaching_assignments")
        .select(
          "id, course_offering_id, instructor_id, session_type, weekly_hours, required_room_type, expected_students, section_id",
        )
        .in("course_offering_id", offeringIds)
    : { data: [] };

  // courses → department (for study_system)
  const courseIds = Array.from(new Set((offerings ?? []).map((o) => o.course_id)));
  const { data: courses } = courseIds.length
    ? await supabase
        .from("courses")
        .select("id, department_id")
        .in("id", courseIds)
    : { data: [] };
  const depIds = Array.from(
    new Set((courses ?? []).map((c) => c.department_id).filter(Boolean) as string[]),
  );
  const { data: deps } = depIds.length
    ? await supabase.from("departments").select("id, study_system").in("id", depIds)
    : { data: [] };
  const depSystem = new Map((deps ?? []).map((d) => [d.id, d.study_system as StudySystem]));
  const courseDep = new Map((courses ?? []).map((c) => [c.id, c.department_id as string | null]));
  const offMap = new Map((offerings ?? []).map((o) => [o.id, o]));

  // rooms
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, capacity, room_type")
    .eq("college_id", collegeId);

  const unplaced: AutoRunResult["unplaced"] = [];
  let placed = 0;

  // Build candidate-slot generator for a given study_system + duration
  const buildCandidates = (system: StudySystem, durationMin: number): CandidateSlot[] => {
    const out: CandidateSlot[] = [];
    const tpls = (templates ?? []).filter(
      (t) => t.study_system === system || t.study_system === "both" || system === "both",
    );
    if (tpls.length > 0) {
      // Use templates as windows; slide by slotMin
      for (const t of tpls) {
        const ws = toMin(t.start_time);
        const we = toMin(t.end_time);
        for (let s = ws; s + durationMin <= we; s += slotMin) {
          out.push({ day: t.day_of_week, start: fromMin(s), end: fromMin(s + durationMin) });
        }
      }
    } else {
      // Fallback to scheduling_settings windows
      const ws = toMin(dayStart);
      const we = toMin(dayEnd);
      for (const d of workingDays) {
        for (let s = ws; s + durationMin <= we; s += slotMin) {
          out.push({ day: d, start: fromMin(s), end: fromMin(s + durationMin) });
        }
      }
    }
    // Sort: earlier day, earlier time
    out.sort((a, b) => a.day - b.day || toMin(a.start) - toMin(b.start));
    return out;
  };

  // Iterate TAs (stable order: by offering id then ta id)
  const sortedTAs = [...(tas ?? [])].sort((a, b) =>
    (a.course_offering_id + a.id).localeCompare(b.course_offering_id + b.id),
  );

  for (const ta of sortedTAs) {
    if (scheduledTAs.has(ta.id)) continue;
    const off = offMap.get(ta.course_offering_id);
    if (!off) continue;
    const sys = depSystem.get(courseDep.get(off.course_id) ?? "") ?? "regular";
    const weekly = Number(ta.weekly_hours ?? 0);
    const durH = Math.min(maxH, Math.max(minH, weekly > 0 ? weekly : minH));
    const durationMin = Math.round(durH * 60);

    const candidates = buildCandidates(sys, durationMin);
    const expected = ta.expected_students || off.expected_students || 0;

    // Candidate rooms ordered: matching type first, then smallest sufficient capacity
    const candidateRooms = [...(rooms ?? [])]
      .filter((r) => (ta.required_room_type ? r.room_type === ta.required_room_type : true))
      .filter((r) => (expected > 0 ? r.capacity >= expected : true))
      .sort((a, b) => a.capacity - b.capacity);
    const roomPool = candidateRooms.length > 0 ? candidateRooms : (rooms ?? []);

    let placedThis = false;
    let lastReason = "no candidate slot/room available";

    outer: for (const slot of candidates) {
      for (const room of roomPool) {
        const proposed: ProposedSession = {
          course_offering_id: ta.course_offering_id,
          teaching_assignment_id: ta.id,
          instructor_id: ta.instructor_id,
          room_id: room.id,
          section_id: ta.section_id ?? null,
          study_system: sys,
          day_of_week: slot.day,
          start_time: slot.start,
          end_time: slot.end,
          session_type: ta.session_type,
          expected_students: expected,
        };
        const conflicts = await validateProposed({
          collegeId,
          scheduleVersionId,
          sessions: [proposed],
        });
        if (conflicts.length === 0) {
          const { error: ie } = await supabase.from("schedule_sessions").insert({
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
          });
          if (!ie) {
            placed++;
            placedThis = true;
            break outer;
          }
          lastReason = ie.message;
        } else {
          lastReason = conflicts[0].message_ar;
        }
      }
    }
    if (!placedThis) {
      unplaced.push({
        course_offering_id: ta.course_offering_id,
        teaching_assignment_id: ta.id,
        instructor_id: ta.instructor_id,
        session_type: ta.session_type,
        reason: lastReason,
      });
    }
  }

  // Final score
  const { result } = await scoreScheduleVersion({
    collegeId,
    scheduleVersionId,
    persist: false,
  });

  const durationMs = Math.round(performance.now() - t0);
  const { data: userData } = await supabase.auth.getUser();
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
      hard_conflicts_after: result.hard_conflicts_count,
      soft_violations_after: result.soft_conflicts_count,
      quality_score_after: result.total_score,
      duration_ms: durationMs,
      summary: {
        breakdown: result.metrics_breakdown,
      } as never,
      unplaced: unplaced as never,
      run_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;

  return {
    runId: row.id,
    placed,
    unplaced,
    hardConflictsAfter: result.hard_conflicts_count,
    softViolationsAfter: result.soft_conflicts_count,
    qualityScoreAfter: result.total_score,
    durationMs,
    totalOfferings,
  };
}
