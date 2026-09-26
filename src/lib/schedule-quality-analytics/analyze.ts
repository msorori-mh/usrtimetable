import {
  DEFAULT_WEIGHTS,
  MAX_CONSECUTIVE_MINUTES,
  MAX_DAILY_INSTRUCTOR_HOURS,
  MAX_ROOM_WEEKLY_HOURS,
  type AnalyticsBaseline,
  type AnalyticsSession,
  type EntityQualityRow,
  type FindingSeverity,
  type QualityAnalyticsReport,
  type QualityFinding,
  type RequiredWorkItem,
  type RoomMeta,
  type StudentMembership,
} from "./types";
import { isSameDeliveryEntry } from "@/lib/scheduling/merged-delivery";

const normalizeTime = (s: string) => (s.length === 5 ? `${s}:00` : s);

export function minutesOf(s: string): number {
  const [h, m] = normalizeTime(s).split(":").map(Number);
  return h * 60 + m;
}

export function sessionHours(s: AnalyticsSession): number {
  return Math.max(0, (minutesOf(s.end_time) - minutesOf(s.start_time)) / 60);
}

export function overlaps(a: AnalyticsSession, b: AnalyticsSession): boolean {
  if (a.day_of_week !== b.day_of_week) return false;
  return (
    normalizeTime(a.start_time) < normalizeTime(b.end_time) &&
    normalizeTime(b.start_time) < normalizeTime(a.end_time)
  );
}

function classifyScore(
  score: number,
  hard: number,
  unscheduled: number,
  capacityViolations: number,
): FindingSeverity {
  if (hard > 0 || unscheduled > 0 || capacityViolations > 0 || score < 50) return "CRITICAL";
  if (score < 70) return "MAJOR";
  if (score < 85) return "MINOR";
  return "ACCEPTABLE";
}

function studyKey(s: AnalyticsSession | RequiredWorkItem): string {
  return String(s.study_system ?? "unknown");
}

/**
 * Pure, deterministic quality analytics over in-memory sessions.
 * Isolates regular/parallel and never mutates inputs.
 */
export function analyzeScheduleQuality(input: {
  sessions: AnalyticsSession[];
  studentMemberships?: StudentMembership[];
  required?: RequiredWorkItem[];
  rooms?: RoomMeta[];
  collegeId?: string;
  baseline?: AnalyticsBaseline | null;
  weeklyRoomCapacityHours?: number;
}): QualityAnalyticsReport {
  const sessions = [...input.sessions].sort((a, b) => a.id.localeCompare(b.id));
  const required = input.required ?? [];
  const rooms = new Map((input.rooms ?? []).map((r) => [r.id, r]));
  const roomCapHours = input.weeklyRoomCapacityHours ?? MAX_ROOM_WEEKLY_HOURS;
  const membersByGroup = new Map<string, StudentMembership[]>();
  for (const membership of input.studentMemberships ?? []) {
    const rows = membersByGroup.get(membership.delivery_group_id) ?? [];
    rows.push(membership);
    membersByGroup.set(membership.delivery_group_id, rows);
  }
  const sharedStudents = (a: AnalyticsSession, b: AnalyticsSession): boolean => {
    if (!a.delivery_group_id || !b.delivery_group_id) {
      return !!a.cohort_id && a.cohort_id === b.cohort_id;
    }
    const left = membersByGroup.get(a.delivery_group_id);
    const right = membersByGroup.get(b.delivery_group_id);
    // Without a complete version membership, keep the conservative cohort check.
    if (
      !left?.length ||
      !right?.length ||
      left.some((m) => !m.partition_id) ||
      right.some((m) => !m.partition_id)
    ) {
      return !!a.cohort_id && a.cohort_id === b.cohort_id;
    }
    const keys = new Set(left.map((m) => `${m.cohort_id}:${m.partition_id}`));
    return right.some((m) => keys.has(`${m.cohort_id}:${m.partition_id}`));
  };
  const findings: QualityFinding[] = [];
  const breakdown: QualityAnalyticsReport["metrics_breakdown"] = {};

  const note = (f: QualityFinding) => {
    findings.push(f);
    breakdown[f.code] = {
      weight: f.weight,
      deduction: (breakdown[f.code]?.deduction ?? 0) + f.deduction,
      count: (breakdown[f.code]?.count ?? 0) + f.count,
      formula: f.formula,
    };
  };

  // Cross-college isolation: drop sessions that do not match college when provided
  const scoped = input.collegeId
    ? sessions.filter((s) => !s.college_id || s.college_id === input.collegeId)
    : sessions;

  // Hard conflicts: instructor, room, or shared student partition within one study system
  const hardPairs: string[] = [];
  for (let i = 0; i < scoped.length; i++) {
    for (let j = i + 1; j < scoped.length; j++) {
      const a = scoped[i];
      const b = scoped[j];
      if (studyKey(a) !== studyKey(b)) continue;
      if (a.academic_term_id && b.academic_term_id && a.academic_term_id !== b.academic_term_id) {
        continue;
      }
      if (!overlaps(a, b)) continue;
      const sameInstructor = a.instructor_id && a.instructor_id === b.instructor_id;
      const sameRoom = a.room_id && a.room_id === b.room_id;
      const sameStudents = sharedStudents(a, b);
      // One actual lecture recorded once per merged group is a single delivery;
      // it must never conflict with itself.
      if (isSameDeliveryEntry(a, b)) continue;
      if (sameInstructor || sameRoom || sameStudents) {
        hardPairs.push(`${a.id}|${b.id}`);
      }
    }
  }
  const hard_conflicts = hardPairs.length;
  if (hard_conflicts > 0) {
    note({
      code: "hard_conflict",
      severity: "CRITICAL",
      title_ar: "تعارضات إلزامية",
      formula: "pair_overlap(instructor|room|student_partition) within study_system × weight",
      weight: DEFAULT_WEIGHTS.hard_conflict,
      count: hard_conflicts,
      deduction: Math.min(100, hard_conflicts * DEFAULT_WEIGHTS.hard_conflict),
      affected_ids: hardPairs.flatMap((p) => p.split("|")),
      detail_ar: `${hard_conflicts} زوج جلسة متداخل على مدرس أو قاعة أو عضوية طلابية.`,
      link_hint: "/reports/conflicts",
    });
  }

  // Unscheduled = required work items with no matching delivery_group/cohort session
  let unscheduled_count = 0;
  const unscheduledIds: string[] = [];
  if (required.length > 0) {
    for (const w of required) {
      const matched = scoped.some((s) => {
        if (studyKey(s) !== studyKey(w)) return false;
        if (w.delivery_group_id) return s.delivery_group_id === w.delivery_group_id;
        if (w.cohort_id) return s.cohort_id === w.cohort_id;
        return false;
      });
      if (!matched) {
        unscheduled_count += 1;
        unscheduledIds.push(w.id);
      }
    }
  }
  if (unscheduled_count > 0) {
    note({
      code: "unscheduled",
      severity: "CRITICAL",
      title_ar: "عناصر غير مجدولة",
      formula: "required_work_items − matched(session by delivery_group|cohort, study_system)",
      weight: DEFAULT_WEIGHTS.unscheduled,
      count: unscheduled_count,
      deduction: Math.min(60, unscheduled_count * DEFAULT_WEIGHTS.unscheduled),
      affected_ids: unscheduledIds,
      detail_ar: `${unscheduled_count} عنصر مطلوب بلا جلسة مطابقة.`,
      link_hint: "/reports/unscheduled",
    });
  }

  // Day distribution
  const day_distribution: Record<number, number> = {};
  for (const s of scoped) {
    day_distribution[s.day_of_week] = (day_distribution[s.day_of_week] ?? 0) + 1;
  }

  // Instructor gaps + excessive daily load + consecutive
  const byInstructorDay = new Map<string, AnalyticsSession[]>();
  for (const s of scoped) {
    if (!s.instructor_id) continue;
    const key = `${s.instructor_id}|${s.day_of_week}|${studyKey(s)}`;
    const list = byInstructorDay.get(key) ?? [];
    list.push(s);
    byInstructorDay.set(key, list);
  }

  let instructor_gaps = 0;
  let excessive_daily_load = 0;
  let long_consecutive = 0;
  const gapIds: string[] = [];
  const loadIds: string[] = [];
  const consecIds: string[] = [];

  for (const [, list] of byInstructorDay) {
    const sorted = [...list].sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    const hours = sorted.reduce((a, s) => a + sessionHours(s), 0);
    if (hours > MAX_DAILY_INSTRUCTOR_HOURS) {
      excessive_daily_load += 1;
      loadIds.push(...sorted.map((s) => s.id));
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = minutesOf(sorted[i + 1].start_time) - minutesOf(sorted[i].end_time);
      if (gap > 60) {
        instructor_gaps += 1;
        gapIds.push(sorted[i].id, sorted[i + 1].id);
      }
      const span = minutesOf(sorted[i + 1].end_time) - minutesOf(sorted[i].start_time);
      if (gap <= 15 && span > MAX_CONSECUTIVE_MINUTES) {
        long_consecutive += 1;
        consecIds.push(sorted[i].id, sorted[i + 1].id);
      }
    }
  }

  if (instructor_gaps > 0) {
    note({
      code: "instructor_gap",
      severity: "MINOR",
      title_ar: "فجوات محاضر",
      formula: "gap_minutes > 60 between consecutive sessions same instructor/day/system",
      weight: DEFAULT_WEIGHTS.instructor_gap,
      count: instructor_gaps,
      deduction: Math.min(30, instructor_gaps * DEFAULT_WEIGHTS.instructor_gap),
      affected_ids: [...new Set(gapIds)],
      detail_ar: `${instructor_gaps} فجوة زمنية > 60 دقيقة لمحاضر.`,
      link_hint: "/reports/instructor-workload",
    });
  }
  if (excessive_daily_load > 0) {
    note({
      code: "excessive_daily_load",
      severity: "MAJOR",
      title_ar: "حمل يومي زائد",
      formula: `sum(session_hours) > ${MAX_DAILY_INSTRUCTOR_HOURS} per instructor/day/system`,
      weight: DEFAULT_WEIGHTS.excessive_daily_load,
      count: excessive_daily_load,
      deduction: Math.min(40, excessive_daily_load * DEFAULT_WEIGHTS.excessive_daily_load),
      affected_ids: [...new Set(loadIds)],
      detail_ar: `${excessive_daily_load} يوم يتجاوز ${MAX_DAILY_INSTRUCTOR_HOURS} ساعات.`,
      link_hint: "/reports/instructor-workload",
    });
  }
  if (long_consecutive > 0) {
    note({
      code: "long_consecutive",
      severity: "MINOR",
      title_ar: "جلسات متتالية طويلة",
      formula: `adjacent gap≤15m and span > ${MAX_CONSECUTIVE_MINUTES}m`,
      weight: DEFAULT_WEIGHTS.long_consecutive,
      count: long_consecutive,
      deduction: Math.min(20, long_consecutive * DEFAULT_WEIGHTS.long_consecutive),
      affected_ids: [...new Set(consecIds)],
      detail_ar: `${long_consecutive} سلسلة متتالية طويلة.`,
      link_hint: "/timetable/$versionId",
    });
  }

  // Cohort gaps (same logic as instructor gaps for cohort)
  const byCohortDay = new Map<string, AnalyticsSession[]>();
  for (const s of scoped) {
    if (!s.cohort_id) continue;
    const key = `${s.cohort_id}|${s.day_of_week}|${studyKey(s)}`;
    const list = byCohortDay.get(key) ?? [];
    list.push(s);
    byCohortDay.set(key, list);
  }
  let cohort_gaps = 0;
  const cohortGapIds: string[] = [];
  for (const [, list] of byCohortDay) {
    const sorted = [...list].sort((a, b) => minutesOf(a.start_time) - minutesOf(b.start_time));
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = minutesOf(sorted[i + 1].start_time) - minutesOf(sorted[i].end_time);
      if (gap > 90) {
        cohort_gaps += 1;
        cohortGapIds.push(sorted[i].id, sorted[i + 1].id);
      }
    }
  }
  if (cohort_gaps > 0) {
    note({
      code: "cohort_gap",
      severity: "MINOR",
      title_ar: "فجوات دفعات",
      formula: "gap_minutes > 90 between consecutive sessions same cohort/day/system",
      weight: DEFAULT_WEIGHTS.cohort_gap,
      count: cohort_gaps,
      deduction: Math.min(30, cohort_gaps * DEFAULT_WEIGHTS.cohort_gap),
      affected_ids: [...new Set(cohortGapIds)],
      detail_ar: `${cohort_gaps} فجوة دفعة > 90 دقيقة.`,
      link_hint: "/reports/program-level-timetable",
    });
  }

  // Room utilization / overuse / balance / capacity
  const byRoom = new Map<string, AnalyticsSession[]>();
  for (const s of scoped) {
    if (!s.room_id) continue;
    const list = byRoom.get(s.room_id) ?? [];
    list.push(s);
    byRoom.set(s.room_id, list);
  }
  let room_overuse = 0;
  let capacity_violations = 0;
  const roomHours: number[] = [];
  const overIds: string[] = [];
  const capIds: string[] = [];
  for (const [roomId, list] of byRoom) {
    const hours = list.reduce((a, s) => a + sessionHours(s), 0);
    roomHours.push(hours);
    if (hours > roomCapHours) {
      room_overuse += 1;
      overIds.push(...list.map((s) => s.id));
    }
    const meta = rooms.get(roomId);
    if (meta?.capacity != null) {
      for (const s of list) {
        if ((s.expected_students ?? 0) > meta.capacity) {
          capacity_violations += 1;
          capIds.push(s.id);
        }
      }
    }
  }
  const mean = roomHours.length === 0 ? 0 : roomHours.reduce((a, b) => a + b, 0) / roomHours.length;
  const room_balance_variance =
    roomHours.length === 0
      ? 0
      : roomHours.reduce((a, h) => a + (h - mean) ** 2, 0) / roomHours.length;

  if (room_overuse > 0) {
    note({
      code: "room_overuse",
      severity: "MAJOR",
      title_ar: "إفراط استخدام قاعة",
      formula: `sum(session_hours) > ${roomCapHours} per room/week`,
      weight: DEFAULT_WEIGHTS.room_overuse,
      count: room_overuse,
      deduction: Math.min(30, room_overuse * DEFAULT_WEIGHTS.room_overuse),
      affected_ids: [...new Set(overIds)],
      detail_ar: `${room_overuse} قاعة تتجاوز السعة الزمنية الأسبوعية.`,
      link_hint: "/reports/room-utilization",
    });
  }
  if (capacity_violations > 0) {
    note({
      code: "capacity",
      severity: "CRITICAL",
      title_ar: "تجاوز سعة القاعة",
      formula: "expected_students > room.capacity",
      weight: DEFAULT_WEIGHTS.capacity,
      count: capacity_violations,
      deduction: Math.min(50, capacity_violations * DEFAULT_WEIGHTS.capacity),
      affected_ids: [...new Set(capIds)],
      detail_ar: `${capacity_violations} جلسة تتجاوز سعة القاعة.`,
      link_hint: "/reports/room-utilization",
    });
  }

  const requiredHours = required.reduce((a, w) => a + (w.hours ?? 0), 0);
  const scheduledHours = scoped.reduce((a, s) => a + sessionHours(s), 0);
  const hours_coverage_pct =
    requiredHours > 0
      ? Math.min(100, Math.round((scheduledHours / requiredHours) * 1000) / 10)
      : scoped.length > 0
        ? 100
        : 0;

  const total_deductions = findings.reduce((a, f) => a + f.deduction, 0);
  const total_score = Math.max(0, Math.round((100 - total_deductions) * 10) / 10);
  const classification = classifyScore(
    total_score,
    hard_conflicts,
    unscheduled_count,
    capacity_violations,
  );

  const buildEntityRows = (
    keyFn: (s: AnalyticsSession) => string | null | undefined,
    labelPrefix: string,
  ): EntityQualityRow[] => {
    const map = new Map<string, AnalyticsSession[]>();
    for (const s of scoped) {
      const id = keyFn(s);
      if (!id) continue;
      const list = map.get(id) ?? [];
      list.push(s);
      map.set(id, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([entity_id, list]) => {
        const systems = [...new Set(list.map(studyKey))].sort().join(",");
        const hours = list.reduce((a, s) => a + sessionHours(s), 0);
        const related = findings
          .filter((f) => f.affected_ids.some((id) => list.some((s) => s.id === id)))
          .map((f) => f.code);
        return {
          entity_id,
          label: `${labelPrefix} ${entity_id.slice(0, 8)}`,
          study_system: systems,
          session_count: list.length,
          hours: Math.round(hours * 100) / 100,
          gap_count: related.filter((c) => c.includes("gap")).length,
          overload_days: related.filter((c) => c === "excessive_daily_load").length,
          findings: [...new Set(related)],
        };
      });
  };

  const baseline = input.baseline ?? null;
  const baseline_delta = baseline
    ? {
        score_delta: Math.round((total_score - baseline.total_score) * 10) / 10,
        hard_delta: hard_conflicts - baseline.hard_conflicts,
        unscheduled_delta: unscheduled_count - baseline.unscheduled_count,
      }
    : null;

  return {
    session_count: scoped.length,
    hard_conflicts,
    unscheduled_count,
    cohort_gaps,
    instructor_gaps,
    excessive_daily_load,
    long_consecutive,
    room_overuse,
    room_balance_variance: Math.round(room_balance_variance * 100) / 100,
    hours_coverage_pct,
    capacity_violations,
    day_distribution,
    total_score,
    classification,
    findings,
    cohort_rows: buildEntityRows((s) => s.cohort_id, "دفعة"),
    instructor_rows: buildEntityRows((s) => s.instructor_id, "محاضر"),
    room_rows: buildEntityRows((s) => s.room_id, "قاعة"),
    metrics_breakdown: breakdown,
    baseline_delta,
  };
}

/** Reject legacy contamination: analytics input must not mix legacy section-only rows when New Flow ids exist. */
export function assertNoLegacyContamination(sessions: AnalyticsSession[]): boolean {
  const hasNewFlow = sessions.some((s) => s.delivery_group_id || s.cohort_id);
  if (!hasNewFlow) return true;
  // If New Flow present, rows without either are flagged as contamination for analytics isolation
  return !sessions.some((s) => !s.delivery_group_id && !s.cohort_id && !s.instructor_id);
}
