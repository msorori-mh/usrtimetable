import { supabase } from "@/integrations/supabase/client";
import { validateProposed, type ProposedSession, type StudySystem } from "@/lib/conflict-engine/validator";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";

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

export interface AutoRunResult {
  runId: string;
  placed: number;
  unplaced: UnplacedItem[];
  totalRequired: number;
  byType: Record<string, { required: number; placed: number; unplaced: number }>;
  warnings: string[];
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

interface SessionUnit {
  session_type: "lecture" | "lab";
  duration_min: number;
  required_room_type: string | null;
  unit_index: number;
}

/**
 * Greedy auto-placer (V1.1 — multi-session expansion).
 * - Expands each teaching_assignment into N session units derived from plan_courses.
 * - Lecture units use lectures_per_week × lecture_session_duration and required_room_type_for_lecture.
 * - Lab units use labs_per_week × lab_session_duration and required_room_type_for_lab.
 * - Falls back to a single session when no plan pattern is found (logged as a warning).
 */
export async function runGreedyAutoSchedule(params: {
  collegeId: string;
  scheduleVersionId: string;
}): Promise<AutoRunResult> {
  const { collegeId, scheduleVersionId } = params;
  const t0 = performance.now();
  const warnings: string[] = [];

  // 1. Scheduling settings (fallback windows)
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
  const maxH = Number(settingsRow?.max_session_hours ?? 4);

  // 2. Time-slot templates
  const { data: templates } = await supabase
    .from("time_slot_templates")
    .select("study_system, day_of_week, start_time, end_time")
    .eq("college_id", collegeId)
    .eq("is_active", true);

  // 3. Existing sessions for this version (to know what's already placed per TA + type)
  const { data: existingSessions } = await supabase
    .from("schedule_sessions")
    .select("teaching_assignment_id, session_type")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", scheduleVersionId);
  const existingCount = new Map<string, number>(); // key = `${ta}|${type}`
  for (const s of existingSessions ?? []) {
    if (!s.teaching_assignment_id) continue;
    const k = `${s.teaching_assignment_id}|${s.session_type}`;
    existingCount.set(k, (existingCount.get(k) ?? 0) + 1);
  }

  // 4. Offerings + TAs + courses/departments/plan_courses
  const { data: offerings } = await supabase
    .from("course_offerings")
    .select("id, course_id, expected_students, college_id, study_plan_id, plan_course_id")
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

  const courseIds = Array.from(new Set((offerings ?? []).map((o) => o.course_id)));
  const { data: courses } = courseIds.length
    ? await supabase.from("courses").select("id, department_id").in("id", courseIds)
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

  // Plan-courses lookup: prefer offering.plan_course_id, else (study_plan_id, course_id)
  const planCourseIds = Array.from(
    new Set((offerings ?? []).map((o) => o.plan_course_id).filter(Boolean) as string[]),
  );
  const { data: pcsById } = planCourseIds.length
    ? await supabase
        .from("plan_courses")
        .select(
          "id, study_plan_id, course_id, lectures_per_week, lecture_session_duration, labs_per_week, lab_session_duration, required_room_type_for_lecture, required_room_type_for_lab",
        )
        .in("id", planCourseIds)
    : { data: [] };
  const pcById = new Map((pcsById ?? []).map((p) => [p.id, p]));

  // Also pull plan_courses by (study_plan_id, course_id) as backup
  const planIds = Array.from(
    new Set((offerings ?? []).map((o) => o.study_plan_id).filter(Boolean) as string[]),
  );
  const { data: pcsByPlan } = planIds.length
    ? await supabase
        .from("plan_courses")
        .select(
          "id, study_plan_id, course_id, lectures_per_week, lecture_session_duration, labs_per_week, lab_session_duration, required_room_type_for_lecture, required_room_type_for_lab",
        )
        .in("study_plan_id", planIds)
    : { data: [] };
  const pcByPlanCourse = new Map(
    (pcsByPlan ?? []).map((p) => [`${p.study_plan_id}|${p.course_id}`, p]),
  );

  // rooms
  const { data: rooms } = await supabase
    .from("rooms")
    .select("id, capacity, room_type")
    .eq("college_id", collegeId);

  const unplaced: UnplacedItem[] = [];
  let placed = 0;
  let totalRequired = 0;
  const byType: Record<string, { required: number; placed: number; unplaced: number }> = {};
  const bump = (type: string, field: "required" | "placed" | "unplaced") => {
    if (!byType[type]) byType[type] = { required: 0, placed: 0, unplaced: 0 };
    byType[type][field]++;
  };

  const clampDuration = (h: number): number => {
    const hh = Math.min(maxH, Math.max(minH, h > 0 ? h : minH));
    return Math.round(hh * 60);
  };

  const buildCandidates = (system: StudySystem, durationMin: number): CandidateSlot[] => {
    const out: CandidateSlot[] = [];
    const tpls = (templates ?? []).filter(
      (t) => t.study_system === system || t.study_system === "both" || system === "both",
    );
    if (tpls.length > 0) {
      for (const t of tpls) {
        const ws = toMin(t.start_time);
        const we = toMin(t.end_time);
        for (let s = ws; s + durationMin <= we; s += slotMin) {
          out.push({ day: t.day_of_week, start: fromMin(s), end: fromMin(s + durationMin) });
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

  const isLecLike = (st: string | null | undefined) =>
    !st || ["lecture", "lec", "نظري", "محاضرة"].includes(st);
  const isLabLike = (st: string | null | undefined) =>
    !!st && ["lab", "practical", "عملي", "مختبر"].includes(st);

  // Build session units for a TA from plan pattern (or fallback)
  const buildUnits = (ta: NonNullable<typeof tas>[number]): SessionUnit[] => {
    const off = offMap.get(ta.course_offering_id);
    if (!off) return [];
    let pc =
      (off.plan_course_id ? pcById.get(off.plan_course_id) : undefined) ??
      (off.study_plan_id ? pcByPlanCourse.get(`${off.study_plan_id}|${off.course_id}`) : undefined);

    const units: SessionUnit[] = [];
    const taType = (ta.session_type ?? "lecture").toLowerCase();

    if (!pc) {
      // Fallback: single session from weekly_hours, using TA's session_type + required_room_type
      warnings.push(
        `no plan_courses pattern for offering ${off.id} — fallback single session for TA ${ta.id}`,
      );
      units.push({
        session_type: isLabLike(taType) ? "lab" : "lecture",
        duration_min: clampDuration(Number(ta.weekly_hours ?? 0)),
        required_room_type: ta.required_room_type ?? null,
        unit_index: 1,
      });
      return units;
    }

    const wantLec = isLecLike(taType) || taType === "both" || taType === "mixed";
    const wantLab = isLabLike(taType) || taType === "both" || taType === "mixed";

    if (wantLec) {
      const n = Number(pc.lectures_per_week ?? 0);
      const dh = Number(pc.lecture_session_duration ?? 0);
      for (let i = 1; i <= n; i++) {
        units.push({
          session_type: "lecture",
          duration_min: clampDuration(dh),
          required_room_type:
            pc.required_room_type_for_lecture ?? ta.required_room_type ?? null,
          unit_index: i,
        });
      }
    }
    if (wantLab) {
      const n = Number(pc.labs_per_week ?? 0);
      const dh = Number(pc.lab_session_duration ?? 0);
      for (let i = 1; i <= n; i++) {
        units.push({
          session_type: "lab",
          duration_min: clampDuration(dh),
          required_room_type:
            pc.required_room_type_for_lab ?? ta.required_room_type ?? null,
          unit_index: i,
        });
      }
    }

    if (units.length === 0) {
      // Pattern existed but had zeros — fallback to weekly_hours single session
      warnings.push(
        `plan_courses pattern has zero sessions for offering ${off.id} — fallback single session`,
      );
      units.push({
        session_type: isLabLike(taType) ? "lab" : "lecture",
        duration_min: clampDuration(Number(ta.weekly_hours ?? 0)),
        required_room_type: ta.required_room_type ?? null,
        unit_index: 1,
      });
    }
    return units;
  };

  const sortedTAs = [...(tas ?? [])].sort((a, b) =>
    (a.course_offering_id + a.id).localeCompare(b.course_offering_id + b.id),
  );

  for (const ta of sortedTAs) {
    const off = offMap.get(ta.course_offering_id);
    if (!off) continue;
    const sys = depSystem.get(courseDep.get(off.course_id) ?? "") ?? "regular";
    const expected = ta.expected_students || off.expected_students || 0;
    const units = buildUnits(ta);

    // Subtract already-placed sessions per type for this TA
    const remaining: SessionUnit[] = [];
    const placedPerType: Record<string, number> = {};
    for (const u of units) {
      const already = existingCount.get(`${ta.id}|${u.session_type}`) ?? 0;
      const doneSoFar = placedPerType[u.session_type] ?? 0;
      if (doneSoFar < already) {
        placedPerType[u.session_type] = doneSoFar + 1;
      } else {
        remaining.push(u);
      }
    }

    for (const unit of remaining) {
      totalRequired++;
      bump(unit.session_type, "required");

      const candidates = buildCandidates(sys, unit.duration_min);
      const candidateRooms = [...(rooms ?? [])]
        .filter((r) => (unit.required_room_type ? r.room_type === unit.required_room_type : true))
        .filter((r) => (expected > 0 ? r.capacity >= expected : true))
        .sort((a, b) => a.capacity - b.capacity);
      const roomPool =
        candidateRooms.length > 0
          ? candidateRooms
          : [...(rooms ?? [])]
              .filter((r) => (expected > 0 ? r.capacity >= expected : true))
              .sort((a, b) => a.capacity - b.capacity);

      let placedThis = false;
      let lastReason = unit.required_room_type
        ? `لا تتوفر قاعة من النوع المطلوب (${unit.required_room_type}) أو فترة زمنية مناسبة`
        : "لا تتوفر فترة زمنية أو قاعة مناسبة";

      if (roomPool.length === 0) {
        lastReason = "لا توجد قاعات متاحة في الكلية";
      }

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
            session_type: unit.session_type,
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
              bump(unit.session_type, "placed");
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
        bump(unit.session_type, "unplaced");
        unplaced.push({
          course_offering_id: ta.course_offering_id,
          teaching_assignment_id: ta.id,
          instructor_id: ta.instructor_id,
          course_id: off.course_id,
          session_type: unit.session_type,
          duration_minutes: unit.duration_min,
          unit_index: unit.unit_index,
          reason: lastReason,
        });
      }
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
        total_required_sessions: totalRequired,
        by_session_type: byType,
        warnings: warnings.slice(0, 50),
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
    totalRequired,
    byType,
    warnings,
    hardConflictsAfter: result.hard_conflicts_count,
    softViolationsAfter: result.soft_conflicts_count,
    qualityScoreAfter: result.total_score,
    durationMs,
    totalOfferings,
  };
}
