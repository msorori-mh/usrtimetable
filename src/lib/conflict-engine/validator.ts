import { supabase } from "@/integrations/supabase/client";
import { categorizeInstructor, requiresAvailability } from "@/lib/instructor-category";

export type StudySystem = "regular" | "parallel" | "both";

export interface ProposedSession {
  id?: string;
  schedule_version_id?: string | null;
  course_offering_id: string;
  teaching_assignment_id?: string | null;
  instructor_id: string;
  room_id?: string | null;
  section_id?: string | null;
  section_group_id?: string | null;
  study_system: StudySystem;
  day_of_week: number;
  start_time: string; // HH:MM or HH:MM:SS
  end_time: string;
  session_type?: string;
  expected_students?: number;
}

export interface Conflict {
  code: string;
  severity: "hard";
  message_ar: string;
  message_en: string;
  schedule_session_id?: string | null;
  related_session_id?: string | null;
  metadata?: Record<string, unknown>;
}

const t = (s: string) => (s.length === 5 ? `${s}:00` : s);
const overlap = (aS: string, aE: string, bS: string, bE: string) =>
  t(aS) < t(bE) && t(bS) < t(aE);
const within = (s: string, e: string, winS: string, winE: string) =>
  t(s) >= t(winS) && t(e) <= t(winE);

interface ExistingSession {
  id: string;
  instructor_id: string;
  room_id: string | null;
  section_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

async function fetchExistingSessions(
  collegeId: string,
  versionId: string,
  excludeSessionId?: string,
): Promise<ExistingSession[]> {
  let q = supabase
    .from("schedule_sessions")
    .select("id, instructor_id, room_id, section_id, day_of_week, start_time, end_time")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", versionId);
  if (excludeSessionId) q = q.neq("id", excludeSessionId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ExistingSession[];
}

/**
 * Validate one or more proposed sessions against a schedule version (dry-run).
 * Does not persist anything. Returns a flat list of conflicts.
 */
export async function validateProposed(params: {
  collegeId: string;
  scheduleVersionId: string;
  sessions: ProposedSession[];
  excludeExistingSessionIds?: string[];
}): Promise<Conflict[]> {
  const { collegeId, scheduleVersionId, sessions } = params;
  const conflicts: Conflict[] = [];

  // Pull existing peers
  const existing = await fetchExistingSessions(collegeId, scheduleVersionId);
  const peers = existing.filter(
    (e) => !(params.excludeExistingSessionIds ?? []).includes(e.id),
  );

  // Pull rooms + room availability
  const roomIds = Array.from(
    new Set(sessions.map((s) => s.room_id).filter(Boolean) as string[]),
  );
  const instructorIds = Array.from(new Set(sessions.map((s) => s.instructor_id)));
  const offeringIds = Array.from(new Set(sessions.map((s) => s.course_offering_id)));

  const [
    { data: rooms },
    { data: roomAvail },
    { data: instrAvail },
    { data: offerings },
    { data: templates },
    { data: instrRows },
  ] = await Promise.all([
    roomIds.length
      ? supabase.from("rooms").select("id, capacity, college_id").in("id", roomIds)
      : Promise.resolve({ data: [] as Array<{ id: string; capacity: number; college_id: string }> }),
    roomIds.length
      ? supabase
          .from("room_availability")
          .select("room_id, day_of_week, start_time, end_time, college_id")
          .in("room_id", roomIds)
      : Promise.resolve({ data: [] as Array<{ room_id: string; day_of_week: number; start_time: string; end_time: string; college_id: string }> }),
    supabase
      .from("instructor_availability")
      .select("instructor_id, day_of_week, start_time, end_time, is_preference, availability_type, college_id")
      .in("instructor_id", instructorIds)
      .eq("is_preference", false),
    offeringIds.length
      ? supabase
          .from("course_offerings")
          .select("id, expected_students, college_id")
          .in("id", offeringIds)
      : Promise.resolve({ data: [] as Array<{ id: string; expected_students: number; college_id: string }> }),
    supabase
      .from("time_slot_templates")
      .select("study_system, day_of_week, start_time, end_time, is_active, college_id")
      .eq("college_id", collegeId)
      .eq("is_active", true),
    instructorIds.length
      ? supabase
          .from("instructors")
          .select("id, instructor_type_id, instructor_types:instructor_type_id ( code, is_external )")
          .in("id", instructorIds)
      : Promise.resolve({ data: [] as Array<{ id: string; instructor_type_id: string | null; instructor_types: { code: string | null; is_external: boolean | null } | null }> }),
  ]);

  // Per-instructor category (permanent / external / other_college)
  const instrCategory = new Map(
    (instrRows ?? []).map((r: any) => [r.id, categorizeInstructor(r.instructor_types)]),
  );

  // College isolation guard
  const allRoomsOk = (rooms ?? []).every((r) => r.college_id === collegeId);
  const allOffOk = (offerings ?? []).every((o) => o.college_id === collegeId);
  if (!allRoomsOk || !allOffOk) {
    throw new Error("Cross-college reference detected");
  }

  const roomMap = new Map((rooms ?? []).map((r) => [r.id, r]));
  const offMap = new Map((offerings ?? []).map((o) => [o.id, o]));

  for (const s of sessions) {
    const sid = s.id ?? null;

    // 1. instructor conflict
    for (const p of peers) {
      if (p.instructor_id === s.instructor_id && p.day_of_week === s.day_of_week &&
          overlap(s.start_time, s.end_time, p.start_time, p.end_time)) {
        conflicts.push({
          code: "instructor_conflict", severity: "hard",
          message_ar: "تعارض المحاضر: نفس المحاضر لديه جلسة أخرى في نفس الوقت.",
          message_en: "Instructor conflict: same instructor has another overlapping session.",
          schedule_session_id: sid, related_session_id: p.id,
          metadata: { instructor_id: s.instructor_id, day_of_week: s.day_of_week },
        });
      }
    }

    // 2. room conflict
    if (s.room_id) {
      for (const p of peers) {
        if (p.room_id === s.room_id && p.day_of_week === s.day_of_week &&
            overlap(s.start_time, s.end_time, p.start_time, p.end_time)) {
          conflicts.push({
            code: "room_conflict", severity: "hard",
            message_ar: "تعارض القاعة: نفس القاعة محجوزة في نفس الوقت.",
            message_en: "Room conflict: same room is booked at the same time.",
            schedule_session_id: sid, related_session_id: p.id,
            metadata: { room_id: s.room_id, day_of_week: s.day_of_week },
          });
        }
      }
    }

    // 3. section conflict
    if (s.section_id) {
      for (const p of peers) {
        if (p.section_id === s.section_id && p.day_of_week === s.day_of_week &&
            overlap(s.start_time, s.end_time, p.start_time, p.end_time)) {
          conflicts.push({
            code: "section_conflict", severity: "hard",
            message_ar: "تعارض الشُّعبة: نفس الشُّعبة لديها جلسة أخرى في نفس الوقت.",
            message_en: "Section conflict: same section has another overlapping session.",
            schedule_session_id: sid, related_session_id: p.id,
            metadata: { section_id: s.section_id, day_of_week: s.day_of_week },
          });
        }
      }
    }

    // 4. room capacity
    if (s.room_id) {
      const room = roomMap.get(s.room_id);
      const offering = offMap.get(s.course_offering_id);
      const expected = s.expected_students ?? offering?.expected_students ?? 0;
      if (room && expected > 0 && room.capacity < expected) {
        conflicts.push({
          code: "room_capacity", severity: "hard",
          message_ar: `سعة القاعة غير كافية: السعة ${room.capacity} والعدد المتوقع ${expected}.`,
          message_en: `Room capacity insufficient: capacity ${room.capacity}, expected ${expected}.`,
          schedule_session_id: sid,
          metadata: { capacity: room.capacity, expected_students: expected },
        });
      }
    }

    // 5. instructor availability — per category (Phase 1.5A business rules)
    const cat = instrCategory.get(s.instructor_id) ?? "permanent";
    const allWindows = (instrAvail ?? []).filter(
      (a) => a.instructor_id === s.instructor_id,
    );
    const hardWindows = allWindows.filter((a) => a.day_of_week === s.day_of_week);
    if (hardWindows.length === 0) {
      // No availability rows for this day.
      // Permanent: assume default working week → no conflict.
      // External / Other college: availability is mandatory → block.
      if (requiresAvailability(cat)) {
        conflicts.push({
          code: "instructor_availability_required",
          severity: "hard",
          message_ar:
            cat === "external"
              ? "المحاضر الخارجي يتطلب تعريف أوقات التوفر قبل الجدولة."
              : "المحاضر من كلية أخرى يتطلب تعريف أوقات التوفر قبل الجدولة.",
          message_en:
            "Instructor availability is mandatory for this category and not defined.",
          schedule_session_id: sid,
          metadata: { instructor_id: s.instructor_id, category: cat, day_of_week: s.day_of_week },
        });
      }
    } else {
      const fits = hardWindows.some(
        (w) => w.availability_type !== "unavailable" &&
          within(s.start_time, s.end_time, w.start_time, w.end_time),
      );
      const blocked = hardWindows.some(
        (w) => w.availability_type === "unavailable" &&
          overlap(s.start_time, s.end_time, w.start_time, w.end_time),
      );
      if (!fits || blocked) {
        conflicts.push({
          code: "instructor_availability", severity: "hard",
          message_ar: "الجلسة خارج نطاق توفّر المحاضر الإلزامي.",
          message_en: "Session outside instructor's hard availability window.",
          schedule_session_id: sid,
          metadata: { instructor_id: s.instructor_id, day_of_week: s.day_of_week, category: cat },
        });
      }
    }

    // 6. room availability (if any defined for this room/day)
    if (s.room_id) {
      const windows = (roomAvail ?? []).filter(
        (a) => a.room_id === s.room_id && a.day_of_week === s.day_of_week,
      );
      if (windows.length > 0 && !windows.some((w) => within(s.start_time, s.end_time, w.start_time, w.end_time))) {
        conflicts.push({
          code: "room_availability", severity: "hard",
          message_ar: "الجلسة خارج نطاق توفّر القاعة المحدد.",
          message_en: "Session outside room's defined availability window.",
          schedule_session_id: sid,
          metadata: { room_id: s.room_id, day_of_week: s.day_of_week },
        });
      }
    }

    // 7. study-system time slot template
    const sysTemplates = (templates ?? []).filter(
      (tt) =>
        tt.day_of_week === s.day_of_week &&
        (tt.study_system === s.study_system || tt.study_system === "both" || s.study_system === "both"),
    );
    if (sysTemplates.length > 0 && !sysTemplates.some((w) => within(s.start_time, s.end_time, w.start_time, w.end_time))) {
      conflicts.push({
        code: "study_system_time_template", severity: "hard",
        message_ar: "الجلسة خارج قوالب الفترات المسموحة لنظام الدراسة.",
        message_en: "Session outside allowed time-slot templates for the study system.",
        schedule_session_id: sid,
        metadata: { study_system: s.study_system, day_of_week: s.day_of_week },
      });
    }
  }

  return conflicts;
}

/**
 * Validate all stored sessions of a schedule version, persist a conflict_check
 * row plus conflict_results, and return the results.
 */
export async function validateScheduleVersion(params: {
  collegeId: string;
  scheduleVersionId: string;
  persist?: boolean; // default true
}): Promise<{ checkId: string | null; conflicts: Conflict[] }> {
  const { collegeId, scheduleVersionId } = params;
  const persist = params.persist ?? true;

  const { data: sessions, error } = await supabase
    .from("schedule_sessions")
    .select("*")
    .eq("college_id", collegeId)
    .eq("schedule_version_id", scheduleVersionId);
  if (error) throw error;

  const proposed: ProposedSession[] = (sessions ?? []).map((s) => ({
    id: s.id,
    schedule_version_id: s.schedule_version_id,
    course_offering_id: s.course_offering_id,
    teaching_assignment_id: s.teaching_assignment_id,
    instructor_id: s.instructor_id,
    room_id: s.room_id,
    section_id: s.section_id,
    section_group_id: s.section_group_id,
    study_system: s.study_system as StudySystem,
    day_of_week: s.day_of_week,
    start_time: s.start_time,
    end_time: s.end_time,
    session_type: s.session_type,
    expected_students: s.expected_students,
  }));

  // Exclude each session's own peers so it's not compared with itself
  const conflicts: Conflict[] = [];
  for (const p of proposed) {
    const sub = await validateProposed({
      collegeId,
      scheduleVersionId,
      sessions: [p],
      excludeExistingSessionIds: p.id ? [p.id] : [],
    });
    conflicts.push(...sub);
  }

  if (!persist) return { checkId: null, conflicts };

  const { data: userData } = await supabase.auth.getUser();
  const { data: chk, error: ce } = await supabase
    .from("conflict_checks")
    .insert({
      college_id: collegeId,
      schedule_version_id: scheduleVersionId,
      check_type: "hard",
      status: "completed",
      total_conflicts: conflicts.length,
      checked_by: userData.user?.id ?? null,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (ce) throw ce;

  if (conflicts.length > 0) {
    // Map codes → constraint_type_id (best-effort)
    const codes = Array.from(new Set(conflicts.map((c) => c.code)));
    const { data: ctypes } = await supabase
      .from("constraint_types")
      .select("id, code")
      .in("code", codes);
    const codeMap = new Map((ctypes ?? []).map((c) => [c.code, c.id]));

    const rows = conflicts.map((c) => ({
      college_id: collegeId,
      conflict_check_id: chk.id,
      schedule_session_id: c.schedule_session_id ?? null,
      related_session_id: c.related_session_id ?? null,
      conflict_type_id: codeMap.get(c.code) ?? null,
      conflict_code: c.code,
      severity: c.severity,
      message_ar: c.message_ar,
      message_en: c.message_en,
      metadata: (c.metadata ?? null) as never,
    }));
    const { error: re } = await supabase.from("conflict_results").insert(rows);
    if (re) throw re;
  }

  return { checkId: chk.id, conflicts };
}
