/** Pure payload builder for the session write RPCs (whitelist; no database access). */

export type StudySystem = "regular" | "parallel" | "both";

export interface ManualSessionForm {
  course_offering_id: string;
  teaching_assignment_id: string | null;
  instructor_id: string;
  room_id: string | null;
  section_id: string | null;
  section_group_id: string | null;
  study_system: StudySystem;
  day_of_week: number;
  start_time: string;
  end_time: string;
  session_type: string;
  expected_students: number;
  is_locked: boolean;
  lock_reason: string | null;
}

/** Fields the server accepts (mirrors the whitelist in _sv_manual_session_evaluate). */
export const MANUAL_SESSION_FIELDS = [
  "course_offering_id",
  "teaching_assignment_id",
  "instructor_id",
  "room_id",
  "section_id",
  "section_group_id",
  "study_system",
  "day_of_week",
  "start_time",
  "end_time",
  "session_type",
  "expected_students",
  "is_locked",
  "lock_reason",
] as const satisfies ReadonlyArray<keyof ManualSessionForm>;

const toTime = (v: string) => {
  const t = v.slice(0, 5);
  return /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : v;
};

/** Explicit whitelist payload — never spreads a fetched row back to the server (pure). */
export function buildManualSessionPayload(
  form: ManualSessionForm,
  scheduleVersionId?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of MANUAL_SESSION_FIELDS) payload[key] = form[key];
  payload.start_time = toTime(form.start_time);
  payload.end_time = toTime(form.end_time);
  payload.expected_students = Math.max(0, Math.trunc(Number(form.expected_students) || 0));
  payload.lock_reason = form.is_locked ? form.lock_reason?.trim() || null : null;
  if (scheduleVersionId) payload.schedule_version_id = scheduleVersionId;
  return payload;
}
