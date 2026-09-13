import { supabase } from "@/integrations/supabase/client";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";
import {
  createScheduleSessionFromAssignmentV2,
  listScheduleBuilderV2WorkItems,
} from "@/lib/schedule-builder/v2-assignment-service";
import type { AutoRunMode, AutoRunResult, UnplacedItem } from "@/lib/auto-scheduler/greedy";
import { loadCompactSnapshot } from "@/lib/auto-scheduler/compact-service";
import { measure, compactSlots, type Session } from "@/lib/auto-scheduler/compact";
import {
  rankGenerationCandidates,
  generationDomainSize,
  compareDifficulty,
} from "@/lib/auto-scheduler/generation-ranking";
import { assessScheduleReadiness } from "@/lib/auto-scheduler/schedule-readiness";
import { isInstructorAvailabilityEnforced } from "@/lib/scheduling/instructor-availability-policy";
import {
  assertVersionNotStale,
  filterCandidateRooms,
  isLocallyBlocked,
  nonconformingWarningAr,
  orderSlotsByDistinctDay,
  planRemainingSessions,
  requiredCadenceForComponent,
  type ExistingSessionLite,
  type OccupiedInterval,
  type PlanCourseCadence,
  type RoomLite,
} from "@/lib/auto-scheduler/session-plan";
import {
  buildPartitionIndex,
  makeSharedStudentsPredicate,
  type PartitionIndex,
  type PartitionMembershipRow,
} from "@/lib/auto-scheduler/student-partitions";

const ALGORITHM_VERSION = "v2-joint-attendance-scarcity-rpc";

/** Fail-closed Arabic note when the partition mapping cannot be used. */
export const PARTITION_FALLBACK_WARNING_AR =
  "لا يمكن قراءة خرائط شُعب الطلاب — تم الاحتفاظ بمنع التعارض على مستوى الدفعة بالكامل.";

/**
 * Load the explicit delivery-group -> student-partition mapping.
 * Any failure (table absent, no permission, empty mapping) returns `null`, and
 * the conservative cohort-wide conflict rule is preserved.
 */
async function loadPartitionIndex(input: {
  cohortIds: string[];
  expectedStudents: Record<string, number | null | undefined>;
}): Promise<{ index: PartitionIndex | null; note: string | null }> {
  if (input.cohortIds.length === 0) return { index: null, note: null };
  try {
    const { data, error } = await (
      supabase as unknown as {
        from: (table: string) => {
          select: (cols: string) => {
            in: (
              col: string,
              values: string[],
            ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
          };
        };
      }
    )
      .from("delivery_group_partition_members")
      .select(
        "delivery_group_id, cohort_id, partition_id, cohort_student_partitions(headcount, active)",
      )
      .in("cohort_id", input.cohortIds);
    if (error) return { index: null, note: PARTITION_FALLBACK_WARNING_AR };
    const rows: PartitionMembershipRow[] = (data ?? [])
      .map((raw): PartitionMembershipRow | null => {
        const row = raw as {
          delivery_group_id?: string;
          cohort_id?: string;
          partition_id?: string;
          cohort_student_partitions?: { headcount?: number | null; active?: boolean | null } | null;
        };
        if (row.cohort_student_partitions?.active === false) return null;
        return {
          delivery_group_id: String(row.delivery_group_id ?? ""),
          cohort_id: String(row.cohort_id ?? ""),
          partition_id: String(row.partition_id ?? ""),
          partition_headcount: row.cohort_student_partitions?.headcount ?? null,
        };
      })
      .filter((row): row is PartitionMembershipRow => !!row && !!row.delivery_group_id);

    if (rows.length === 0) return { index: null, note: null };
    return {
      index: buildPartitionIndex({ rows, expectedStudents: input.expectedStudents }),
      note: null,
    };
  } catch {
    return { index: null, note: PARTITION_FALLBACK_WARNING_AR };
  }
}

const pad = (value: number) => String(value).padStart(2, "0");
const fromMinutes = (value: number) => `${pad(Math.floor(value / 60))}:${pad(value % 60)}:00`;

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
  if (!payload.rows.length) {
    throw new Error(
      "لا توجد إسنادات للجدولة. استكمل الخطط والدفعات والمدرسين والإسناد ثم أعد التوليد.",
    );
  }

  const [
    { data: rooms, error: roomsError },
    { data: templates, error: templatesError },
    { data: existingSessions, error: sessionsError },
    { data: roomTypeRows, error: roomTypesError },
    { data: roomAvailabilityRows, error: roomAvailabilityError },
  ] = await Promise.all([
    supabase
      .from("rooms")
      .select(
        "id, capacity, room_type, room_type_id, available_days, available_start_time, available_end_time",
      )
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
    supabase.from("room_types").select("id, code").eq("college_id", params.collegeId),
    supabase
      .from("room_availability")
      .select("room_id, day_of_week, start_time, end_time")
      .eq("college_id", params.collegeId),
  ]);
  if (roomsError) throw new Error(`V2_AUTO_QUERY_FAILED[rooms]: ${roomsError.message}`);
  if (roomTypesError) throw new Error(`V2_AUTO_QUERY_FAILED[room_types]: ${roomTypesError.message}`);
  if (roomAvailabilityError) {
    throw new Error(`V2_AUTO_QUERY_FAILED[room_availability]: ${roomAvailabilityError.message}`);
  }

  if (templatesError) {
    throw new Error(`V2_AUTO_QUERY_FAILED[time_slot_templates]: ${templatesError.message}`);
  }
  if (sessionsError) {
    throw new Error(`V2_AUTO_QUERY_FAILED[schedule_sessions]: ${sessionsError.message}`);
  }
  if (!rooms?.length) throw new Error("V2_AUTO_BLOCKED: لا توجد قاعات متاحة.");
  if (!templates?.length) throw new Error("V2_AUTO_BLOCKED: لا توجد قوالب زمنية نشطة.");

  /** room_types.id → code, so the room-type policy can be evaluated on codes. */
  const roomTypeCodeById: Record<string, string | null> = {};
  for (const row of roomTypeRows ?? []) roomTypeCodeById[row.id] = row.code ?? null;
  const roomAvailability: RoomAvailabilityWindow[] = (roomAvailabilityRows ?? []).map((row) => ({
    room_id: String(row.room_id),
    day_of_week: Number(row.day_of_week),
    start_time: String(row.start_time),
    end_time: String(row.end_time),
  }));
  const roomById = new Map((rooms ?? []).map((room) => [room.id, room]));
  /** Practical sessions placed in a lecture hall through the allowed fallback. */
  let practicalRoomFallbacks = 0;



  const workItems = payload.rows.filter(
    (item) =>
      item.can_create_session &&
      item.delivery_group_id &&
      item.cohort_id &&
      (item.study_system === "regular" || item.study_system === "parallel"),
  );
  const timedScope = payload.rows.filter(
    (item) =>
      item.assignment_active &&
      item.delivery_group_active &&
      !item.delivery_group_obsolete &&
      !item.is_project &&
      !item.is_summer_training,
  );
  const blockedWorkItems = timedScope.filter((item) => item.scheduling_status === "blocked");
  if (!workItems.length) {
    throw new Error(
      blockedWorkItems.length
        ? `توجد ${blockedWorkItems.length} إسنادات محظورة. استكمل البيانات المبيّنة في شاشة الإسناد قبل التوليد.`
        : "لا توجد ساعات مؤهلة إضافية للجدولة. راجع اكتمال الإسنادات ونمط الجلسات في المسودة.",
    );
  }
  const planningSnapshot = await loadCompactSnapshot(params.collegeId, params.scheduleVersionId);
  const planningSessions = [...planningSnapshot.sessions];
  const seedFor = (item: (typeof workItems)[number], length: number): Session => ({
    id: `candidate:${item.teaching_assignment_id}:${planningSessions.length}`,
    updated_at: "",
    cohort_id: item.cohort_id!,
    delivery_group_id: item.delivery_group_id!,
    teaching_assignment_id: item.teaching_assignment_id,
    instructor_id: item.instructor_id,
    room_id: "",
    day_of_week: 0,
    start_time: "00:00:00",
    end_time: fromMinutes(length),
    study_system: item.study_system!,
    expected_students: item.expected_students,
    is_locked: false,
  });

  // Plan cadence lookup: component -> plan_course -> validated weekly pattern.
  const componentIds = Array.from(
    new Set(
      timedScope
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

  const { data: attendanceCohorts, error: attendanceError } = await supabase
    .from("academic_cohorts")
    .select("id,program_id,level_id,study_system,term_id")
    .eq("college_id", params.collegeId);
  if (attendanceError || !attendanceCohorts?.length) {
    throw new Error("تعذر قراءة مستويات الدفعات للتحقق من حد خمسة أيام.");
  }
  const levelByCohort = new Map(
    attendanceCohorts.map((c) => [
      c.id,
      [c.program_id, c.level_id, c.study_system, c.term_id].join("|"),
    ]),
  );
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

  // Shared-student semantics: explicit partition membership per delivery group.
  const expectedStudentsByGroup: Record<string, number | null | undefined> = {};
  for (const item of workItems) {
    if (item.delivery_group_id)
      expectedStudentsByGroup[item.delivery_group_id] = item.expected_students;
  }
  const partitions = await loadPartitionIndex({
    cohortIds: Array.from(
      new Set(workItems.map((item) => item.cohort_id).filter((id): id is string => !!id)),
    ),
    expectedStudents: expectedStudentsByGroup,
  });
  const sharedStudents = partitions.index
    ? makeSharedStudentsPredicate(partitions.index)
    : undefined;

  const unplaced: UnplacedItem[] = [];
  const warnings: string[] = [];
  for (const item of blockedWorkItems)
    warnings.push(
      `${item.course_code} / ${item.group_code ?? ""}: ${item.blocking_reason ?? "إسناد محظور يحتاج استكمال البيانات."}`,
    );
  if (partitions.note) warnings.push(partitions.note);
  const byType: Record<string, { required: number; placed: number; unplaced: number }> = {};
  let placed = 0;
  let cancelled = false;
  let nonconformingSessions = 0;
  let blockedCadenceItems = 0;
  let versionUpdatedAt = payload.version_updated_at;
  let processedItems = 0;
  // A server-proven missing mandatory availability window is invariant across
  // rooms/times on that instructor/day. Cache only this rejection for this run;
  // no conflict is ignored and all writes still use the guarded RPC.
  const unavailableInstructorDays = new Map<string, string>();

  const difficulties = new Map<
    string,
    { candidateCount: number; durationMinutes: number; expectedStudents: number; id: string }
  >();
  for (const item of workItems) {
    if (params.signal?.aborted) break;
    const component = componentById.get(item.plan_course_component_id || item.component_id);
    const cadence = requiredCadenceForComponent({
      componentType: item.component_type,
      assignedHours:
        item.assigned_component_hours > 0
          ? item.assigned_component_hours
          : Number(component?.weekly_contact_hours ?? 0),
      planCourse: component ? planCourseById.get(component.plan_course_id) : null,
    });
    const durationMinutes = Math.max(0, ...cadence.durations) * 60;
    const roomIds = (rooms ?? [])
      .filter((room) => room.capacity >= item.expected_students)
      .map((room) => room.id);
    const candidateCount =
      durationMinutes > 0
        ? generationDomainSize({
            snapshot: planningSnapshot,
            sessions: planningSessions,
            session: seedFor(item, durationMinutes),
            slots: compactSlots(
              { ...planningSnapshot, sessions: planningSessions },
              seedFor(item, durationMinutes),
            ),
            roomIds,
          })
        : 0;
    difficulties.set(item.teaching_assignment_id, {
      candidateCount,
      durationMinutes,
      expectedStudents: item.expected_students,
      id: item.teaching_assignment_id,
    });
    params.onProgress?.({
      processedItems: 0,
      totalItems: workItems.length,
      placed: 0,
      unplaced: 0,
      label: `فحص خيارات الجدولة: ${difficulties.size} / ${workItems.length}`,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  workItems.sort((a, b) =>
    compareDifficulty(
      difficulties.get(a.teaching_assignment_id) ?? {
        candidateCount: Infinity,
        durationMinutes: 0,
        expectedStudents: 0,
        id: a.teaching_assignment_id,
      },
      difficulties.get(b.teaching_assignment_id) ?? {
        candidateCount: Infinity,
        durationMinutes: 0,
        expectedStudents: 0,
        id: b.teaching_assignment_id,
      },
    ),
  );

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
    if (cadence.source === "blocked") {
      // Never invent a cadence: report and skip this component.
      blockedCadenceItems++;
      byType[type].unplaced++;
      unplaced.push({
        course_offering_id: item.course_offering_id,
        teaching_assignment_id: item.teaching_assignment_id,
        instructor_id: item.instructor_id,
        course_id: item.course_id,
        session_type: item.session_type || item.component_type,
        duration_minutes: 0,
        unit_index: 1,
        reason: `${groupLabel}: ${cadence.noteAr ?? "نمط الخطة الأسبوعي غير صالح."}`,
      });
      processedItems++;
      params.onProgress?.({
        processedItems,
        totalItems: workItems.length,
        placed,
        unplaced: unplaced.length,
        label: groupLabel,
      });
      continue;
    }

    const existing =
      existingByAssignment.get(`${item.teaching_assignment_id}|${item.delivery_group_id}`) ?? [];
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
      roomTypeName: component?.required_room_type_id
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
        compactSlots(
          { ...planningSnapshot, sessions: planningSessions },
          seedFor(item, durationMinutes),
        ),
        usedDays,
      );
      const levelKey = levelByCohort.get(item.cohort_id!);
      if (!levelKey) throw new Error("لا توجد بيانات مستوى لهذه الدفعة.");
      const levelDays = new Set(
        occupied
          .filter((x) => x.cohortId && levelByCohort.get(x.cohortId) === levelKey)
          .map((x) => x.day),
      );
      const rankedCandidates = rankGenerationCandidates({
        snapshot: planningSnapshot,
        sessions: planningSessions,
        session: seedFor(item, durationMinutes),
        slots,
        roomIds: candidateRooms.map((room) => room.id),
        usedDays,
      });
      let placedItem = false;
      let lastReason = "لا يوجد مرشح يحقق قيود مجموعة التقديم والدفعة.";

      candidateSearch: for (const ranked of rankedCandidates) {
        const slot = {
          day: ranked.session.day_of_week,
          start: ranked.session.start_time,
          end: ranked.session.end_time,
        };
        if (params.signal?.aborted) {
          cancelled = true;
          break;
        }
        if (!levelDays.has(slot.day) && levelDays.size >= 5) {
          lastReason = "حد حضور المستوى خمسة أيام أسبوعياً؛ لا يجوز إنشاء يوم سادس.";
          continue;
        }
        const availabilityKey = `${item.instructor_id}|${slot.day}`;
        const unavailableReason = unavailableInstructorDays.get(availabilityKey);
        if (unavailableReason) {
          lastReason = unavailableReason;
          continue;
        }
        for (const room of candidateRooms.filter(
          (candidate) => candidate.id === ranked.session.room_id,
        )) {
          if (params.signal?.aborted) {
            cancelled = true;
            break candidateSearch;
          }
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
              sharedStudents,
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
            planningSessions.push({ ...ranked.session, ...result.session } as Session);
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
          // Availability-based day skipping only applies when enforcement is on.
          if (
            isInstructorAvailabilityEnforced() &&
            result.blocking_conflicts.some(
              (conflict) => conflict.code === "instructor_availability_required",
            )
          ) {
            unavailableInstructorDays.set(availabilityKey, lastReason);
            continue candidateSearch;
          }
        }
        if (placedItem) break;
      }

      if (cancelled) {
        warnings.push(
          "تم إيقاف التشغيل. الجلسات المحفوظة باقية، والوحدات غير المفحوصة ليست فاشلة.",
        );
        break;
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

  const after = await scoreScheduleVersion({
    collegeId: params.collegeId,
    scheduleVersionId: params.scheduleVersionId,
    persist: false,
  });
  // Authoritative readback covers the whole active scope, including already scheduled work.
  const finalSnapshot = await loadCompactSnapshot(params.collegeId, params.scheduleVersionId);
  const attendance = measure(finalSnapshot);
  const requirements = timedScope.map((item) => {
    const component = componentById.get(item.plan_course_component_id || item.component_id);
    const cadence = requiredCadenceForComponent({
      componentType: item.component_type,
      assignedHours:
        item.assigned_component_hours > 0
          ? item.assigned_component_hours
          : Number(component?.weekly_contact_hours ?? 0),
      planCourse: component ? planCourseById.get(component.plan_course_id) : null,
    });
    return {
      id: item.teaching_assignment_id,
      groupId: item.delivery_group_id,
      type: item.component_type || item.session_type || "theory",
      requiredDurations: cadence.durations,
      blocked: cadence.source === "blocked" || item.scheduling_status === "blocked",
    };
  });
  const readiness = assessScheduleReadiness({
    assignments: requirements,
    sessions: finalSnapshot.sessions,
    levelsOverFive: attendance.levelsOverFive,
    hardConflicts: after.result.hard_conflicts_count,
    softConflicts: after.result.soft_conflicts_count,
    cancelled,
  });
  const totalRequiredSessions = readiness.requiredSessions;
  // Per-type totals use the same complete scope as the headline count, including on cancellation.
  for (const key of Object.keys(byType)) delete byType[key];
  for (const requirement of requirements) {
    const row = (byType[requirement.type] ??= { required: 0, placed: 0, unplaced: 0 });
    const reconciled = planRemainingSessions({
      requiredDurations: requirement.requiredDurations,
      existing: finalSnapshot.sessions.filter(
        (session) =>
          session.teaching_assignment_id === requirement.id &&
          session.delivery_group_id === requirement.groupId,
      ),
    });
    row.required += requirement.requiredDurations.length;
    row.placed += reconciled.conforming.length;
    row.unplaced += reconciled.remaining.length;
  }
  if (!readiness.complete)
    warnings.push(
      `المسودة غير مكتملة: ${readiness.remainingSessions} جلسة متبقية، ${readiness.blockedAssignments} إسناد محظور، ${readiness.nonconformingSessions} جلسة لا تطابق النمط المطلوب.`,
    );
  const durationMs = Math.round(performance.now() - startedAt);
  const { data: userData } = await supabase.auth.getUser();
  const { data: run, error: runError } = await supabase
    .from("auto_schedule_runs")
    .insert({
      college_id: params.collegeId,
      schedule_version_id: params.scheduleVersionId,
      algorithm: ALGORITHM_VERSION,
      status: readiness.complete ? "completed" : "partial",
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
        ordering_strategy: "compatible_room_time_count_then_duration_then_headcount",
        attendance_objective: "equal_average_student_and_instructor_gap",
        blocked_work_items: blockedWorkItems.length,
        attendance,
        readiness,
        cadence_source: "plan_courses_weekly_pattern",
        cadence_invention: "disabled",
        student_partition_semantics: partitions.index
          ? "explicit_partition_membership"
          : "cohort_wide_fallback",
        regular_parallel_isolation: true,
        total_required_sessions: totalRequiredSessions,
        processed_work_items: processedItems,
        blocked_cadence_items: blockedCadenceItems,
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
