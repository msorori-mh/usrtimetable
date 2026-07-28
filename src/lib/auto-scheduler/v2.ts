import { supabase } from "@/integrations/supabase/client";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";
import {
  createScheduleSessionFromAssignmentV2,
  listScheduleBuilderV2WorkItems,
} from "@/lib/schedule-builder/v2-assignment-service";
import type { AutoRunMode, AutoRunResult, UnplacedItem } from "@/lib/auto-scheduler/greedy";

const ALGORITHM_VERSION = "v2-delivery-group-guarded-rpc";

type CandidateSlot = {
  day: number;
  start: string;
  end: string;
};

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

/**
 * New Flow auto-scheduler.
 *
 * Identity and writes are exclusively V2: work items are teaching assignment +
 * delivery group + cohort, and every session is created through the guarded V2
 * RPC that rechecks instructor/room/cohort/delivery-group conflicts, capacity,
 * room type, availability, study-system templates, term, college and hours.
 */
export async function runV2AutoSchedule(params: {
  collegeId: string;
  scheduleVersionId: string;
  mode?: AutoRunMode;
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

  const [{ data: rooms, error: roomsError }, { data: templates, error: templatesError }] =
    await Promise.all([
      supabase
        .from("rooms")
        .select("id, capacity, room_type")
        .eq("college_id", params.collegeId)
        .order("capacity", { ascending: true }),
      supabase
        .from("time_slot_templates")
        .select("study_system, day_of_week, start_time, end_time")
        .eq("college_id", params.collegeId)
        .eq("is_active", true),
    ]);
  if (roomsError) throw new Error(`V2_AUTO_QUERY_FAILED[rooms]: ${roomsError.message}`);
  if (templatesError) {
    throw new Error(`V2_AUTO_QUERY_FAILED[time_slot_templates]: ${templatesError.message}`);
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
  const unplaced: UnplacedItem[] = [];
  const warnings: string[] = [];
  const byType: Record<string, { required: number; placed: number; unplaced: number }> = {};
  let placed = 0;
  let versionUpdatedAt = payload.version_updated_at;

  for (const item of workItems) {
    const type = item.component_type || item.session_type || "theory";
    byType[type] ??= { required: 0, placed: 0, unplaced: 0 };
    byType[type].required++;

    const durationMinutes = Math.max(
      60,
      Math.min(240, Math.round(item.remaining_schedule_hours * 60)),
    );
    const slots = buildSlots({
      templates: templates ?? [],
      studySystem: item.study_system!,
      durationMinutes,
    });
    const candidateRooms = (rooms ?? []).filter(
      (room) => !item.expected_students || room.capacity >= item.expected_students,
    );
    let placedItem = false;
    let lastReason = "لا يوجد مرشح يحقق قيود مجموعة التقديم والدفعة.";

    for (const slot of slots) {
      for (const room of candidateRooms) {
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
        if (result.stale) {
          throw new Error("V2_AUTO_STALE_VERSION: تغيّرت نسخة الجدول أثناء التشغيل.");
        }
        if (result.ok && result.session && result.schedule_version_updated_at) {
          versionUpdatedAt = result.schedule_version_updated_at;
          placed++;
          byType[type].placed++;
          placedItem = true;
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
      status: unplaced.length === 0 ? "completed" : "partial",
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
        regular_parallel_isolation: true,
        total_required_sessions: workItems.length,
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
    totalRequired: workItems.length,
    byType,
    warnings,
    hardConflictsAfter: after.result.hard_conflicts_count,
    softViolationsAfter: after.result.soft_conflicts_count,
    qualityScoreBefore: qualityBefore,
    qualityScoreAfter: qualityAfter,
    improvementDelta: qualityAfter - qualityBefore,
    preservedExistingSessions: payload.rows.reduce((sum, item) => sum + item.session_count, 0),
    relocatedSessions: 0,
    backtrackingAttempts: 0,
    durationMs,
    totalOfferings: workItems.length,
    mode,
    deletedAutoSessions: 0,
    skippedLockedSessions: 0,
  };
}
