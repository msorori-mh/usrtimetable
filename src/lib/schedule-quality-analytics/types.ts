/**
 * Read-only schedule quality analytics — pure functions, no DB writes.
 * Mission: SCHEDULE-QUALITY-ANALYTICS-CENTER-01
 */

export type StudySystem = "regular" | "parallel" | string;

export interface AnalyticsSession {
  id: string;
  college_id?: string | null;
  schedule_version_id?: string | null;
  instructor_id: string | null;
  room_id: string | null;
  cohort_id?: string | null;
  delivery_group_id?: string | null;
  course_offering_id?: string | null;
  study_system: StudySystem | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  expected_students?: number | null;
  session_type?: string | null;
  academic_term_id?: string | null;
}

/** Snapshot of one student partition enrolled in a delivery group for this version. */
export interface StudentMembership {
  delivery_group_id: string;
  cohort_id: string;
  partition_id: string | null;
}

export interface RoomMeta {
  id: string;
  capacity?: number | null;
  room_type_id?: string | null;
  name?: string | null;
}

export interface RequiredWorkItem {
  id: string;
  study_system: StudySystem | null;
  cohort_id?: string | null;
  delivery_group_id?: string | null;
  instructor_id?: string | null;
  hours?: number | null;
}

export type FindingSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "ACCEPTABLE";

export interface QualityFinding {
  code: string;
  severity: FindingSeverity;
  title_ar: string;
  formula: string;
  weight: number;
  count: number;
  deduction: number;
  affected_ids: string[];
  detail_ar: string;
  link_hint: string;
}

export interface EntityQualityRow {
  entity_id: string;
  label: string;
  study_system: string;
  session_count: number;
  hours: number;
  gap_count: number;
  overload_days: number;
  findings: string[];
}

export interface QualityAnalyticsReport {
  session_count: number;
  hard_conflicts: number;
  unscheduled_count: number;
  cohort_gaps: number;
  instructor_gaps: number;
  excessive_daily_load: number;
  long_consecutive: number;
  room_overuse: number;
  room_balance_variance: number;
  hours_coverage_pct: number;
  capacity_violations: number;
  day_distribution: Record<number, number>;
  total_score: number;
  classification: FindingSeverity;
  findings: QualityFinding[];
  cohort_rows: EntityQualityRow[];
  instructor_rows: EntityQualityRow[];
  room_rows: EntityQualityRow[];
  metrics_breakdown: Record<
    string,
    { weight: number; deduction: number; count: number; formula: string }
  >;
  baseline_delta: {
    score_delta: number;
    hard_delta: number;
    unscheduled_delta: number;
  } | null;
}

export interface AnalyticsBaseline {
  total_score: number;
  hard_conflicts: number;
  unscheduled_count: number;
}

export const DEFAULT_WEIGHTS = {
  hard_conflict: 25,
  unscheduled: 15,
  cohort_gap: 8,
  instructor_gap: 6,
  excessive_daily_load: 5,
  long_consecutive: 4,
  room_overuse: 5,
  capacity: 10,
} as const;

/** Max session hours per instructor per day before MAJOR load finding. */
export const MAX_DAILY_INSTRUCTOR_HOURS = 6;
/** Max consecutive span (minutes) before long-consecutive finding. */
export const MAX_CONSECUTIVE_MINUTES = 180;
/** Room weekly hours above this trigger overuse (fallback capacity window). */
export const MAX_ROOM_WEEKLY_HOURS = 40;
