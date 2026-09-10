import { supabase } from "@/integrations/supabase/client";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";
import {
  createScheduleSessionFromAssignmentV2,
  listScheduleBuilderV2WorkItems,
} from "@/lib/schedule-builder/v2-assignment-service";
import type { AutoRunMode, AutoRunResult, UnplacedItem } from "@/lib/auto-scheduler/greedy";
import {
  assertVersionNotStale,
  filterCandidateRooms,
  isLocallyBlocked,
  nonconformingWarningAr,
  orderSlotsByDistinctDay,
  planRemainingSessions,
  requiredCadenceForComponent,
  type CandidateSlot,
  type ExistingSessionLite,
  type OccupiedInterval,
  type PlanCourseCadence,
  type RoomLite,
} from "@/lib/auto-scheduler/session-plan";

const ALGORITHM_VERSION = "v2-plan-cadence-guarded-rpc";

const pad = (value: number) => String(value).padStart(2, "0");
const toMinutes = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
};
const fromMinutes = (value: number) => `${pad(Math.floor(value / 60))}:${pad(value % 60)}:00`;

function buildSlots(input: {
  templates: Array<{
    study_system: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
  }>;
  studySystem: string;
  durationMinutes: number;
}): CandidateSlot[] {
  const slots: CandidateSlot[] = [];
  const templates = input.templates.filter(
    (template) => template.study_system === input.studySystem || template.study_system === "both",
  );
  for (const template of templates) {
    const start = toMinutes(template.start_time);
    const end = toMinutes(template.end_time);
    for (let cursor = start; cursor + input.durationMinutes <= end; cursor += 60) {
      slots.push({
        day: template.day_of_week,
        start: fromMinutes(cursor),
        end: fromMinutes(cursor + input.durationMinutes),
      });
    }
  }
  return slots.sort((a, b) => a.day - b.day || toMinutes(a.start) - toMinutes(b.start));
}

export type AutoScheduleProgress = {
  processedItems: number;
  totalItems: number;
  placed: number;
  unplaced: number;
  label: string;
};

/**
 * New Flow auto-scheduler.
 *
 * Identity and writes are exclusively V2: work items are teaching assignment +
 * delivery group + cohort, and every session is created through the guarded V2
 * RPC that rechecks instructor/room/cohort/delivery-group conflicts, capacity,
 * room type, availability, study-system templates, term, college and hours.
 *
 * JAWF-SESSION-DURATION-01: weekly cadence now comes from the validated
 * `plan_courses` counts/durations for the component family (theory/tutorial ->
 * lectures, practical -> labs), so a 4h theory component becomes 2 weekly 2h
 * sessions instead of a single 4h block. Existing sessions are reconciled
 * (resume/idempotency), never modified, and nonconforming ones are reported.
 */
export async function runV2AutoSchedule(params: {
  collegeId: string;
  scheduleVersionId: string;
  mode?: AutoRunMode;
  onProgress?: (progress: AutoScheduleProgress) => void;
  signal?: AbortSignal;
}): Promise<AutoRunResult> {
  const mode = params.mode ?? "fill_missing";
  if (mode !== "fill_missing") {
    throw new Error(
      "V2_DESTRUCTIVE_MODE_BLOCKED: إعادة التوليد والبناء الكامل تحتاج RPC ذرية خاصة بالتدفق الجديد.",
    );
  }

  const startedAt = performance.now();
  const before = await scoreScheduleVersion({
    collegeId: params.collegeId,
    scheduleVersionId: params.scheduleVersionId,
    persist: false,
  });
  const payload = await listScheduleBuilderV2WorkItems({
    scheduleVersionId: params.scheduleVersionId,
  });
  if (!payload.ok || !payload.can_manage) {
    throw new Error("V2_WORK_ITEMS_FORBIDDEN: تعذر تحميل وحدات الجدولة المصرح بها.");
  }

  const [
    { data: rooms, error: roomsError },
    { data: templates, error: templatesError },
    { data: existingSessions, error: sessionsError },
  ] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, capacity, room_type, room_type_id")
      .eq("college_id", params.collegeId)
      .order("capacity", { ascending: true }),
    supabase
      .from("time_slot_templates")
      .select("study_system, day_of_week, start_time, end_time")
      .eq("college_id", params.collegeId)
      .eq("is_active", true),
    supabase
      .from("schedule_sessions")
      .select(
        "id, day_of_week, start_time, end_time, room_id, instructor_id, cohort_id, delivery_group_id, teaching_assignment_id",
      )
      .eq("schedule_version_id", params.scheduleVersionId),
  ]);
  if (roomsError) throw new Error(`V2_AUTO_QUERY_FAILED[rooms]: ${roomsError.message}`);
  if (templatesError) {
    throw new Error(`V2_AUTO_QUERY_FAILED[time_slot_templates]: ${templatesError.message}`);
  }
  if (sessionsError) {
    throw new Error(`V2_AUTO_QUERY_FAILED[schedule_sessions]: ${sessionsError.message}`);
  }
  if (!rooms?.length) throw new Error("V2_AUTO_BLOCKED: لا توجد قاعات متاحة.");
  if (!templates?.length) throw new Error("V2_AUTO_BLOCKED: لا توجد قوالب زمنية نشطة.");

  const workItems = payload.rows.filter(
    (item) =>
      item.can_create_session &&
      item.delivery_group_id &&
      item.cohort_id &&
      (item.study_system === "regular" || item.study_system === "parallel"),
  );

  // Plan cadence lookup: component -> plan_course -> validated weekly pattern.
  const componentIds = Array.from(
    new Set(
      workItems
        .map((item) => item.plan_course_component_id || item.component_id)
        .filter((id): id is string => !!id),
    ),
  );
  const { data: components, error: componentsError } = componentIds.length
    ? await supabase
        .from("plan_course_components")
        .select("id, plan_course_id, component_type, weekly_contact_hours, required_room_type_id")
        .in("id", componentIds)
    : { data: [], error: null };
  if (componentsError) {
    throw new Error(`V2_AUTO_QUERY_FAILED[plan_course_components]: ${componentsError.message}`);
  }
  const componentById = new Map((components ?? []).map((c) => [c.id, c]));
  const planCourseIds = Array.from(
    new Set((components ?? []).map((c) => c.plan_course_id).filter(Boolean)),
  );
  const { data: planCourses, error: planCoursesError } = planCourseIds.length
    ? await supabase
        .from("plan_courses")
        .select(
          "id, lectures_per_week, lecture_session_duration, labs_per_week, lab_session_duration, required_room_type_for_lecture, required_room_type_for_lab",
        )
        .in("id", planCourseIds)
    : { data: [], error: null };
  if (planCoursesError) {
    throw new Error(`V2_AUTO_QUERY_FAILED[plan_courses]: ${planCoursesError.message}`);
  }
  const planCourseById = new Map((planCourses ?? []).map((p) => [p.id, p as PlanCourseCadence]));

  const sessionRows = existingSessions ?? [];
  const existingByAssignment = new Map<string, ExistingSessionLite[]>();
  for (const row of sessionRows) {
    const key = `${row.teaching_assignment_id ?? ""}|${row.delivery_group_id ?? ""}`;
    const list = existingByAssignment.get(key) ?? [];
    list.push({
      id: row.id,
      day_of_week: row.day_of_week,
      start_time: row.start_time,
      end_time: row.end_time,
      room_id: row.room_id,
    });
    existingByAssignment.set(key, list);
  }
  const occupied: OccupiedInterval[] = sessionRows.map((row) => ({
    day: row.day_of_week,
    start: row.start_time,
    end: row.end_time,
    roomId: row.room_id,
    instructorId: row.instructor_id,
    cohortId: row.cohort_id,
    deliveryGroupId: row.delivery_group_id,
  }));

  const unplaced: UnplacedItem[] = [];
  const warnings: string[] = [];
  const byType: Record<string, { required: number; placed: number; unplaced: number }> = {};
  let placed = 0;
  let cancelled = false;
  let nonconformingSessions = 0;
  let versionUpdatedAt = payload.version_updated_at;
  let processedItems = 0;

  for (const item of workItems) {
    if (params.signal?.aborted) {
      cancelled = true;
      warnings.push("تم إيقاف التشغيل بطلب المستخدم. الجلسات التي أُنشئت قبل الإيقاف محفوظة.");
      break;
    }

    const type = item.component_type || item.session_type || "theory";
    byType[type] ??= { required: 0, placed: 0, unplaced: 0 };

    const component = componentById.get(item.plan_course_component_id || item.component_id);
    const planCourse = component ? planCourseById.get(component.plan_course_id) : null;
    const assignedHours =
      item.assigned_component_hours > 0
        ? item.assigned_component_hours
        : Number(component?.weekly_contact_hours ?? 0);
    const cadence = requiredCadenceForComponent({
      componentType: item.component_type,
      assignedHours,
      planCourse,
    });
    const groupLabel = `${item.course_code}${item.group_code ? ` / ${item.group_code}` : ""}`;
    if (cadence.noteAr) warnings.push(`${groupLabel}: ${cadence.noteAr}`);

    const existing = existingByAssignment.get(`${item.teaching_assignment_id}|${item.delivery_group_id}`) ?? [];
    const plan = planRemainingSessions({
      requiredDurations: cadence.durations,
      existing,
    });
    byType[type].required += cadence.durations.length;
    byType[type].placed += plan.conforming.length;

    if (plan.nonconforming.length > 0) {
      nonconformingSessions += plan.nonconforming.length;
      warnings.push(
        nonconformingWarningAr({
          courseCode: item.course_code,
          componentType: type,
          groupCode: item.group_code,
          sessions: plan.nonconforming,
          requiredDurations: cadence.durations,
        }),
      );
    }

    const usedDays = [...plan.usedDays];
    const roomRequirement = {
      roomTypeId: component?.required_room_type_id ?? null,
      roomTypeName:
        component?.required_room_type_id
          ? null
          : ((item.component_type === "practical"
              ? planCourse?.required_room_type_for_lab
              : planCourse?.required_room_type_for_lecture) ?? null),
      expectedStudents: item.expected_students,
    };
    let candidateRooms = filterCandidateRooms(rooms as RoomLite[], roomRequirement);
    if (candidateRooms.length === 0) {
      // Room-type prefilter is advisory only; fall back to capacity-only candidates.
      candidateRooms = filterCandidateRooms(rooms as RoomLite[], {
        expectedStudents: item.expected_students,
      });
    }

    for (const durationHours of plan.remaining) {
      if (params.signal?.aborted) {
        cancelled = true;
        warnings.push("تم إيقاف التشغيل بطلب المستخدم. الجلسات التي أُنشئت قبل الإيقاف محفوظة.");
        break;
      }
      const durationMinutes = Math.max(30, Math.round(durationHours * 60));
      const slots = orderSlotsByDistinctDay(
        buildSlots({
          templates: templates ?? [],
          studySystem: item.study_system!,
          durationMinutes,
        }),
        usedDays,
      );
      let placedItem = false;
      let lastReason = "لا يوجد مرشح يحقق قيود مجموعة التقديم والدفعة.";

      for (const slot of slots) {
        for (const room of candidateRooms) {
          if (
            isLocallyBlocked(
              slot,
              {
                roomId: room.id,
                instructorId: item.instructor_id,
                cohortId: item.cohort_id,
                deliveryGroupId: item.delivery_group_id,
              },
              occupied,
            )
          ) {
            continue;
          }
          const result = await createScheduleSessionFromAssignmentV2({
            scheduleVersionId: params.scheduleVersionId,
            teachingAssignmentId: item.teaching_assignment_id,
            dayOfWeek: slot.day,
            startTime: slot.start,
            endTime: slot.end,
            roomId: room.id,
            expectedVersionUpdatedAt: versionUpdatedAt,
            note: `auto:${ALGORITHM_VERSION}`,
          });
          assertVersionNotStale(result);
          if (result.ok && result.session && result.schedule_version_updated_at) {
            versionUpdatedAt = result.schedule_version_updated_at;
            placed++;
            byType[type].placed++;
            placedItem = true;
            usedDays.push(slot.day);
            occupied.push({
              day: slot.day,
              start: slot.start,
              end: slot.end,
              roomId: room.id,
              instructorId: item.instructor_id,
              cohortId: item.cohort_id,
              deliveryGroupId: item.delivery_group_id,
            });
            break;
          }
          lastReason =
            result.blocking_conflicts[0]?.message_ar ||
            result.warnings[0]?.message_ar ||
            result.message_ar ||
            result.code ||
            lastReason;
        }
        if (placedItem) break;
      }

      if (!placedItem) {
        byType[type].unplaced++;
        unplaced.push({
          course_offering_id: item.course_offering_id,
          teaching_assignment_id: item.teaching_assignment_id,
          instructor_id: item.instructor_id,
          course_id: item.course_id,
          session_type: item.session_type || item.component_type,
          duration_minutes: durationMinutes,
          unit_index: 1,
          reason: lastReason,
        });
      }
    }

    processedItems++;
    params.onProgress?.({
      processedItems,
      totalItems: workItems.length,
      placed,
      unplaced: unplaced.length,
      label: groupLabel,
    });
    if (cancelled) break;
  }

  const totalRequiredSessions = Object.values(byType).reduce((sum, v) => sum + v.required, 0);
  const after = await scoreScheduleVersion({
    collegeId: params.collegeId,
    scheduleVersionId: params.scheduleVersionId,
    persist: false,
  });
  const durationMs = Math.round(performance.now() - startedAt);
  const { data: userData } = await supabase.auth.getUser();
  const { data: run, error: runError } = await supabase
    .from("auto_schedule_runs")
    .insert({
      college_id: params.collegeId,
      schedule_version_id: params.scheduleVersionId,
      algorithm: ALGORITHM_VERSION,
      status: unplaced.length === 0 && !cancelled ? "completed" : "partial",
      total_offerings: workItems.length,
      placed_sessions: placed,
      unplaced_sessions: unplaced.length,
      hard_conflicts_after: after.result.hard_conflicts_count,
      soft_violations_after: after.result.soft_conflicts_count,
      quality_score_after: after.result.total_score,
      duration_ms: durationMs,
      summary: {
        algorithm_version: ALGORITHM_VERSION,
        identity: "teaching_assignment+delivery_group+cohort",
        mode,
        cancelled,
        cadence_source: "plan_courses_weekly_pattern",
        regular_parallel_isolation: true,
        total_required_sessions: totalRequiredSessions,
        processed_work_items: processedItems,
        nonconforming_existing_sessions: nonconformingSessions,
        by_component_type: byType,
      } as never,
      unplaced: unplaced as never,
      run_by: userData.user?.id ?? null,
    })
    .select("id")
    .single();
  if (runError || !run) {
    throw new Error(`V2_AUTO_RUN_RECORD_FAILED: ${runError?.message ?? "missing run row"}`);
  }

  const qualityBefore = before.result.total_score;
  const qualityAfter = after.result.total_score;
  return {
    runId: run.id,
    placed,
    unplaced,
    totalRequired: totalRequiredSessions,
    byType,
    warnings,
    hardConflictsAfter: after.result.hard_conflicts_count,
    softViolationsAfter: after.result.soft_conflicts_count,
    qualityScoreBefore: qualityBefore,
    qualityScoreAfter: qualityAfter,
    improvementDelta: qualityAfter - qualityBefore,
    preservedExistingSessions: sessionRows.length,
    relocatedSessions: 0,
    backtrackingAttempts: 0,
    durationMs,
    totalOfferings: workItems.length,
    mode,
    deletedAutoSessions: 0,
    skippedLockedSessions: 0,
  };
}
