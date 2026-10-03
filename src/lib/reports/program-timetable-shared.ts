/**
 * A merged lecture is expanded into one copy per attending cohort for
 * student-facing timetables; a copy's id is the physical session id followed
 * by ":<cohort>:<group>". Totals and coverage must count the lecture once.
 */
export function physicalSessionId(id: string | number | null | undefined): string {
  return String(id ?? "").split(":")[0] ?? "";
}

/** Keeps the first copy of every physical session, in the original order. */
export function uniquePhysicalSessions<T extends { id?: string | number | null }>(
  sessions: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const session of sessions) {
    const id = physicalSessionId(session.id);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    result.push(session);
  }
  return result;
}
