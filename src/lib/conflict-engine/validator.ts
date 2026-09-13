import { supabase } from "@/integrations/supabase/client";
import { buildInstructorCategoryMap, requiresAvailability } from "@/lib/instructor-category";
import { isInstructorAvailabilityEnforced } from "@/lib/scheduling/instructor-availability-policy";
import { evaluateCapacityAgainstRoom } from "@/lib/schedule-builder/enrollment-trust";
import {
  CAPACITY_EXCEPTION_LIMIT,
  sameSectionSubgroupConflict,
} from "@/lib/schedule-builder/section-subgroups";
import { sessionTypeRequiredRoomTypeConflict } from "@/lib/schedule-builder/room-type-policy";
import { isRoomTypeCompatible } from "@/lib/scheduling/room-type-policy";
import {
  buildApprovedExceptionIndex,
  findMatchingException,
  loadApprovedExceptions,
  summarizeConflictExceptions,
  type ApprovedException,
} from "./exceptions";

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
  section_subgroup_id?: string | null;
  study_system: StudySystem;
  day_of_week: number;
  start_time: string; // HH:MM or HH:MM:SS
  end_time: string;
  session_type?: string;
  expected_students?: number;
  enrollment_count_status?: string | null;
  replaced_by_split?: boolean;
}

export interface Conflict {
  code: string;
  severity: "hard" | "soft";
  message_ar: string;
  message_en: string;
  schedule_session_id?: string | null;
  related_session_id?: string | null;
  metadata?: Record<string, unknown>;
  approved_exception?: boolean;
  exception_id?: string | null;
  exception_reason?: string | null;
}

export interface ValidationResult {
  conflicts: Conflict[];
  totalHardConflicts: number;
  approvedHardConflicts: number;
  unapprovedHardConflicts: number;
}

const t = (s: string) => (s.length === 5 ? `${s}:00` : s);
const overlap = (aS: string, aE: string, bS: string, bE: string) => t(aS) < t(bE) && t(bS) < t(aE);
const within = (s: string, e: string, winS: string, winE: string) =>
  t(s) >= t(winS) && t(e) <= t(winE);

interface ExistingSession {
  id: string;
  instructor_id: string;
  room_id: string | null;
  section_id: string | null;
  section_subgroup_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  replaced_by_split?: boolean | null;
}

async function fetchExistingSessions(
  collegeId: string,
  versionId: string,
  excludeSessionId?: string,
): Promise<ExistingSession[]> {
  let q = supabase
    .from("schedule_sessions")
    .select(
      "id, instructor_id, room_id, section_id, section_subgroup_id, day_of_week, start_time, end_time, replaced_by_split",
    )
    .eq("college_id", collegeId)
    .eq("schedule_version_id", versionId)
    .eq("replaced_by_split", false);
  if (excludeSessionId) q = q.neq("id", excludeSessionId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as ExistingSession[];
}

/**
 * Validate one or more proposed sessions against a schedule version (dry-run).
 * Does not persist anything. Returns a flat list of conflicts.
 */
export function applyApprovedExceptions(
  conflicts: Conflict[],
  scheduleVersionId: string,
  approvedExceptions?: ApprovedException[],
): ValidationResult {
  const index = buildApprovedExceptionIndex(approvedExceptions ?? [], scheduleVersionId);
  const enriched = conflicts.map((c) => {
    const match = findMatchingException(index, {
      scheduleVersionId,
      conflictCode: c.code,
      sessionId: c.schedule_session_id,
      relatedSessionId: c.related_session_id,
    });
    if (!match) {
      return { ...c, approved_exception: false, exception_id: null, exception_reason: null };
    }
    return {
      ...c,
      approved_exception: true,
      exception_id: match.id,
      exception_reason: match.reason,
    };
  });
  const summary = summarizeConflictExceptions(enriched);
  return { conflicts: enriched, ...summary };
}

export async function validateProposed(params: {
  collegeId: string;
  scheduleVersionId: string;
  sessions: ProposedSession[];
  excludeExistingSessionIds?: string[];
  approvedExceptions?: ApprovedException[];
}): Promise<ValidationResult> {
  const { collegeId, scheduleVersionId, sessions } = params;
  const conflicts: Conflict[] = [];

  // Pull existing peers
  const existing = await fetchExistingSessions(collegeId, scheduleVersionId);
  const peers = existing.filter((e) => !(params.excludeExistingSessionIds ?? []).includes(e.id));

  // Pull rooms + room availability
  const roomIds = Array.from(new Set(sessions.map((s) => s.room_id).filter(Boolean) as string[]));
  const instructorIds = Array.from(new Set(sessions.map((s) => s.instructor_id)));
  const offeringIds = Array.from(new Set(sessions.map((s) => s.course_offering_id)));
  const taIds = Array.from(
    new Set(sessions.map((s) => s.teaching_assignment_id).filter(Boolean) as string[]),
  );

  const [
    { data: rooms },
    { data: roomAvail },
    { data: instrAvail },
    { data: offerings },
    { data: templates },
    { data: instrRows },
    { data: taRows },
  ] = await Promise.all([
    roomIds.length
      ? supabase.from("rooms").select("id, capacity, college_id, room_type").in("id", roomIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            capacity: number;
            college_id: string;
            room_type: string | null;
          }>,
        }),
    roomIds.length
      ? supabase
          .from("room_availability")
          .select("room_id, day_of_week, start_time, end_time, college_id")
          .in("room_id", roomIds)
      : Promise.resolve({
          data: [] as Array<{
            room_id: string;
            day_of_week: number;
            start_time: string;
            end_time: string;
            college_id: string;
          }>,
        }),
    supabase
      .from("instructor_availability")
      .select(
        "instructor_id, day_of_week, start_time, end_time, is_preference, availability_type, college_id",
      )
      .in("instructor_id", instructorIds)
      .eq("is_preference", false),
    offeringIds.length
      ? supabase
          .from("course_offerings")
          .select("id, expected_students, enrollment_count_status, college_id")
          .in("id", offeringIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            expected_students: number;
            enrollment_count_status: string | null;
            college_id: string;
          }>,
        }),
    supabase
      .from("time_slot_templates")
      .select("study_system, day_of_week, start_time, end_time, is_active, college_id")
      .eq("college_id", collegeId)
      .eq("is_active", true),
    instructorIds.length
      ? supabase.from("instructors").select("id, instructor_type_id").in("id", instructorIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            instructor_type_id: string | null;
          }>,
        }),
    taIds.length
      ? supabase
          .from("teaching_assignments")
          .select("id, required_room_type, college_id, plan_course_component_id")
          .in("id", taIds)
      : Promise.resolve({
          data: [] as Array<{
            id: string;
            required_room_type: string | null;
            college_id: string;
            plan_course_component_id?: string | null;
          }>,
        }),
  ]);

  // Resolve instructor types explicitly. Some deployed schemas contain
  // instructor_type_id without a PostgREST-discoverable FK, so an embedded
  // instructor_types(...) select raises PGRST200.
  const instructorTypeIds = Array.from(
    new Set(
      (instrRows ?? [])
        .map((row) => row.instructor_type_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: instructorTypeRows, error: instructorTypeError } = instructorTypeIds.length
    ? await supabase
        .from("instructor_types")
        .select("id, code, is_external")
        .eq("college_id", collegeId)
        .in("id", instructorTypeIds)
    : {
        data: [] as Array<{ id: string; code: string | null; is_external: boolean | null }>,
        error: null,
      };
  if (instructorTypeError) throw instructorTypeError;

  // Per-instructor category (permanent / external / other_college)
  const instrCategory = buildInstructorCategoryMap(instrRows ?? [], instructorTypeRows ?? []);

  // College isolation guard
  const allRoomsOk = (rooms ?? []).every((r) => r.college_id === collegeId);
  const allOffOk = (offerings ?? []).every((o) => o.college_id === collegeId);
  const allTasOk = (taRows ?? []).every((ta) => ta.college_id === collegeId);
  if (!allRoomsOk || !allOffOk || !allTasOk) {
    throw new Error("Cross-college reference detected");
  }

  const roomMap = new Map((rooms ?? []).map((r) => [r.id, r]));
  const offMap = new Map((offerings ?? []).map((o) => [o.id, o]));
  const taMap = new Map((taRows ?? []).map((ta) => [ta.id, ta]));

  // Plan-course component type per assignment: the room-type policy allows the
  // practical computer_lab → lecture_hall fallback only.
  const componentIds = Array.from(
    new Set(
      (taRows ?? [])
        .map((ta) => ta.plan_course_component_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const { data: componentRows } = componentIds.length
    ? await supabase
        .from("plan_course_components")
        .select("id, component_type")
        .eq("college_id", collegeId)
        .in("id", componentIds)
    : { data: [] as Array<{ id: string; component_type: string | null }> };
  const componentTypeById = new Map(
    (componentRows ?? []).map((row) => [row.id, row.component_type ?? null]),
  );
  const componentTypeByAssignment = new Map(
    (taRows ?? []).map((ta) => [
      ta.id,
      ta.plan_course_component_id
        ? (componentTypeById.get(ta.plan_course_component_id) ?? null)
        : null,
    ]),
  );

  for (const s of sessions) {
    const sid = s.id ?? null;

    // 1. instructor conflict
    for (const p of peers) {
      if (sid && p.id === sid) continue;
      if (
        p.instructor_id === s.instructor_id &&
        p.day_of_week === s.day_of_week &&
        overlap(s.start_time, s.end_time, p.start_time, p.end_time)
      ) {
        conflicts.push({
          code: "instructor_conflict",
          severity: "hard",
          message_ar: "تعارض المحاضر: نفس المحاضر لديه محاضرة أخرى في نفس الوقت.",
          message_en: "Instructor conflict: same instructor has another overlapping session.",
          schedule_session_id: sid,
          related_session_id: p.id,
          metadata: { instructor_id: s.instructor_id, day_of_week: s.day_of_week },
        });
      }
    }

    // 2. room conflict
    if (s.room_id) {
      for (const p of peers) {
        if (sid && p.id === sid) continue;
        if (
          p.room_id === s.room_id &&
          p.day_of_week === s.day_of_week &&
          overlap(s.start_time, s.end_time, p.start_time, p.end_time)
        ) {
          conflicts.push({
            code: "room_conflict",
            severity: "hard",
            message_ar: "تعارض القاعة: نفس القاعة محجوزة في نفس الوقت.",
            message_en: "Room conflict: same room is booked at the same time.",
            schedule_session_id: sid,
            related_session_id: p.id,
            metadata: { room_id: s.room_id, day_of_week: s.day_of_week },
          });
        }
      }
    }

    // 3. section / capacity-subgroup conflict
    if (s.section_id) {
      for (const p of peers) {
        if (sid && p.id === sid) continue;
        if (
          p.day_of_week === s.day_of_week &&
          overlap(s.start_time, s.end_time, p.start_time, p.end_time) &&
          sameSectionSubgroupConflict(
            { section_id: s.section_id, section_subgroup_id: s.section_subgroup_id ?? null },
            { section_id: p.section_id, section_subgroup_id: p.section_subgroup_id ?? null },
          )
        ) {
          conflicts.push({
            code: "section_conflict",
            severity: "hard",
            message_ar: "تعارض المجموعة: نفس المجموعة لديها محاضرة أخرى في نفس الوقت.",
            message_en: "Section conflict: same section has another overlapping session.",
            schedule_session_id: sid,
            related_session_id: p.id,
            metadata: {
              section_id: s.section_id,
              section_subgroup_id: s.section_subgroup_id ?? null,
              day_of_week: s.day_of_week,
            },
          });
        }
      }
    }

    // 4. room capacity (+5 for confirmed only) + required room type
    if (s.room_id) {
      const room = roomMap.get(s.room_id);
      const offering = offMap.get(s.course_offering_id) as
        | {
            expected_students: number;
            enrollment_count_status?: string | null;
          }
        | undefined;
      const expected = s.expected_students ?? offering?.expected_students ?? 0;
      const enrollStatus =
        s.enrollment_count_status ?? offering?.enrollment_count_status ?? "unverified";
      if (room) {
        const cap = evaluateCapacityAgainstRoom({
          enrollmentCount: expected,
          enrollmentStatus: enrollStatus,
          roomCapacity: room.capacity,
          capacityExceptionLimit: CAPACITY_EXCEPTION_LIMIT,
        });
        if (cap.outcome === "hard_block") {
          conflicts.push({
            code: "room_capacity",
            severity: "hard",
            message_ar: `سعة القاعة غير كافية للعدد المعتمد: السعة ${room.capacity} (+${CAPACITY_EXCEPTION_LIMIT}) والعدد ${expected}.`,
            message_en: `Room capacity insufficient for confirmed enrollment: capacity ${room.capacity} (+${CAPACITY_EXCEPTION_LIMIT}), count ${expected}.`,
            schedule_session_id: sid,
            metadata: {
              capacity: room.capacity,
              capacity_plus_exception: room.capacity + CAPACITY_EXCEPTION_LIMIT,
              expected_students: expected,
              enrollment_count_status: cap.status,
            },
          });
        } else if (cap.outcome === "soft_warning") {
          conflicts.push({
            code: "room_capacity_unverified",
            severity: "soft",
            message_ar: `تحذير سعة: العدد غير معتمد (${cap.status}). السعة ${room.capacity} (+${CAPACITY_EXCEPTION_LIMIT}) والعدد ${expected}.`,
            message_en: `Capacity warning: enrollment status ${cap.status}. capacity ${room.capacity} (+${CAPACITY_EXCEPTION_LIMIT}), count ${expected}.`,
            schedule_session_id: sid,
            metadata: {
              capacity: room.capacity,
              capacity_plus_exception: room.capacity + CAPACITY_EXCEPTION_LIMIT,
              expected_students: expected,
              enrollment_count_status: cap.status,
              blocking: false,
            },
          });
        }
      }
      const requiredType = s.teaching_assignment_id
        ? (taMap.get(s.teaching_assignment_id)?.required_room_type ?? null)
        : null;
      const dq = sessionTypeRequiredRoomTypeConflict({
        sessionType: s.session_type,
        requiredRoomType: requiredType,
      });
      if (dq.conflict) {
        conflicts.push({
          code: "session_room_type_data_quality",
          severity: "soft",
          message_ar: `تحذير جودة بيانات: نوع الجلسة يقترح ${dq.sessionPreferred.join("/")} بينما required_room_type=${dq.requiredRoomType}.`,
          message_en: `Data quality warning: session_type prefers ${dq.sessionPreferred.join("/")} but required_room_type=${dq.requiredRoomType}.`,
          schedule_session_id: sid,
          metadata: {
            session_type: s.session_type ?? null,
            session_preferred: dq.sessionPreferred,
            required_room_type: dq.requiredRoomType,
            auto_corrected: false,
          },
        });
      }
      const componentType = s.teaching_assignment_id
        ? (componentTypeByAssignment.get(s.teaching_assignment_id) ?? s.session_type ?? null)
        : (s.session_type ?? null);
      // Practical components requiring computer_lab may legitimately use a
      // lecture_hall (same rule as is_assignment_room_compatible in the DB).
      if (
        room &&
        requiredType &&
        !isRoomTypeCompatible({
          componentType,
          requiredRoomType: requiredType,
          roomType: room.room_type,
        })
      ) {
        conflicts.push({
          code: "room_type_mismatch",
          severity: "hard",
          message_ar: `نوع القاعة لا يطابق المطلوب: المطلوب ${requiredType} والقاعة ${room.room_type ?? "unknown"}.`,
          message_en: `Room type mismatch: required ${requiredType}, room is ${room.room_type ?? "unknown"}.`,
          schedule_session_id: sid,
          metadata: {
            required_room_type: requiredType,
            room_type: room.room_type,
            room_id: s.room_id,
            teaching_assignment_id: s.teaching_assignment_id,
          },
        });
      }
    }

    // 5. instructor availability — only when enforcement is switched on.
    // Default: every instructor is available on all approved teaching times,
    // and missing/incomplete availability rows never block scheduling.
    const cat = instrCategory.get(s.instructor_id) ?? "permanent";
    const allWindows = isInstructorAvailabilityEnforced()
      ? (instrAvail ?? []).filter((a) => a.instructor_id === s.instructor_id)
      : [];
    const hardWindows = isInstructorAvailabilityEnforced()
      ? allWindows.filter((a) => a.day_of_week === s.day_of_week)
      : [];
    if (!isInstructorAvailabilityEnforced()) {
      // no availability conflict is produced in this mode
    } else if (hardWindows.length === 0) {
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
          message_en: "Instructor availability is mandatory for this category and not defined.",
          schedule_session_id: sid,
          metadata: { instructor_id: s.instructor_id, category: cat, day_of_week: s.day_of_week },
        });
      }
    } else {
      // Domain: active instructors are available by default during working days.
      // Hard unavailability rows are a blacklist. Positive hard windows (if any)
      // remain a whitelist for that day. Soft preferences are ignored here.
      const blocked = hardWindows.some(
        (w) =>
          w.availability_type === "unavailable" &&
          overlap(s.start_time, s.end_time, w.start_time, w.end_time),
      );
      const positiveWindows = hardWindows.filter((w) => w.availability_type !== "unavailable");
      const fits =
        positiveWindows.length === 0 ||
        positiveWindows.some((w) => within(s.start_time, s.end_time, w.start_time, w.end_time));
      if (blocked || !fits) {
        conflicts.push({
          code: "instructor_availability",
          severity: "hard",
          message_ar: blocked
            ? "المحاضرة تتعارض مع فترة عدم توفّر المحاضر الإلزامية."
            : "المحاضرة خارج نطاق توفّر المحاضر الإلزامي.",
          message_en: blocked
            ? "Session overlaps instructor hard unavailability."
            : "Session outside instructor's hard availability window.",
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
      if (
        windows.length > 0 &&
        !windows.some((w) => within(s.start_time, s.end_time, w.start_time, w.end_time))
      ) {
        conflicts.push({
          code: "room_availability",
          severity: "hard",
          message_ar: "المحاضرة خارج نطاق توفّر القاعة المحدد.",
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
        (tt.study_system === s.study_system ||
          tt.study_system === "both" ||
          s.study_system === "both"),
    );
    if (
      sysTemplates.length > 0 &&
      !sysTemplates.some((w) => within(s.start_time, s.end_time, w.start_time, w.end_time))
    ) {
      conflicts.push({
        code: "study_system_time_template",
        severity: "hard",
        message_ar: "المحاضرة خارج قوالب أوقات المحاضرات المسموحة لنظام الدراسة.",
        message_en: "Session outside allowed time-slot templates for the study system.",
        schedule_session_id: sid,
        metadata: { study_system: s.study_system, day_of_week: s.day_of_week },
      });
    }
  }

  return applyApprovedExceptions(conflicts, scheduleVersionId, params.approvedExceptions);
}

/**
 * Validate all stored sessions of a schedule version, persist a conflict_check
 * row plus conflict_results, and return the results.
 */
export async function validateScheduleVersion(params: {
  collegeId: string;
  scheduleVersionId: string;
  persist?: boolean; // default true
}): Promise<{ checkId: string | null; result: ValidationResult }> {
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
    conflicts.push(...sub.conflicts);
  }
  const approvedExceptions = await loadApprovedExceptions({ scheduleVersionId, collegeId });
  const result = applyApprovedExceptions(conflicts, scheduleVersionId, approvedExceptions);

  if (!persist) return { checkId: null, result };

  const { data: userData } = await supabase.auth.getUser();
  const { data: chk, error: ce } = await supabase
    .from("conflict_checks")
    .insert({
      college_id: collegeId,
      schedule_version_id: scheduleVersionId,
      check_type: "hard",
      status: "completed",
      total_conflicts: result.totalHardConflicts,
      checked_by: userData.user?.id ?? null,
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (ce) throw ce;

  if (result.conflicts.length > 0) {
    // Map codes → constraint_type_id (best-effort)
    const codes = Array.from(new Set(result.conflicts.map((c) => c.code)));
    const { data: ctypes } = await supabase
      .from("constraint_types")
      .select("id, code")
      .in("code", codes);
    const codeMap = new Map((ctypes ?? []).map((c) => [c.code, c.id]));

    const rows = result.conflicts.map((c) => ({
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

  return { checkId: chk.id, result };
}
