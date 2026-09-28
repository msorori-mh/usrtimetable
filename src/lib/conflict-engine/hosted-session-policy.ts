/** Hosting approval belongs to one exact scheduled session, not to its room. */
export interface HostedSessionShape {
  id?: string;
  schedule_version_id?: string | null;
  course_offering_id: string;
  teaching_assignment_id?: string | null;
  instructor_id: string;
  room_id?: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  study_system: string;
  expected_students?: number | null;
}

export function matchesVerifiedHostedSession(
  proposed: HostedSessionShape,
  verified: HostedSessionShape,
  versionId: string,
): boolean {
  const time = (value: string) => (value.length === 5 ? `${value}:00` : value);
  return Boolean(
    proposed.id &&
    proposed.id === verified.id &&
    verified.schedule_version_id === versionId &&
    proposed.schedule_version_id === versionId &&
    proposed.course_offering_id === verified.course_offering_id &&
    (proposed.teaching_assignment_id ?? null) === (verified.teaching_assignment_id ?? null) &&
    proposed.instructor_id === verified.instructor_id &&
    proposed.room_id === verified.room_id &&
    proposed.day_of_week === verified.day_of_week &&
    time(proposed.start_time) === time(verified.start_time) &&
    time(proposed.end_time) === time(verified.end_time) &&
    proposed.study_system === verified.study_system &&
    (proposed.expected_students ?? null) === (verified.expected_students ?? null),
  );
}
