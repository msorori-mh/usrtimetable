/** Counts meetings, independently of their duration or regular/parallel system. */
export const MAX_INSTRUCTOR_SESSIONS_PER_DAY = 3;
export function instructorDailySessionViolations(
  sessions: readonly {
    instructor_id: string;
    day_of_week: number;
    replaced_by_split?: boolean | null;
  }[],
) {
  const counts = new Map<
    string,
    { instructorId: string; day: number; count: number }
  >();
  for (const s of sessions) {
    if (s.replaced_by_split) continue;
    const key = `${s.instructor_id}|${s.day_of_week}`;
    const row = counts.get(key) ?? {
      instructorId: s.instructor_id,
      day: s.day_of_week,
      count: 0,
    };
    row.count++;
    counts.set(key, row);
  }
  return [...counts.values()].filter(
    (row) => row.count > MAX_INSTRUCTOR_SESSIONS_PER_DAY,
  );
}
