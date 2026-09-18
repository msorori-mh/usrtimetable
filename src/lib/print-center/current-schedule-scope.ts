import type { PrintSessionLike } from "./types";

/** The department belongs to the student's program, not the course's owner. */
export function filterCurrentScheduleScope(
  sessions: PrintSessionLike[],
  programs: { id: string; department_id: string | null }[],
  departmentId: string,
  programId: string,
): PrintSessionLike[] {
  const byId = new Map(programs.map((p) => [p.id, p]));
  return sessions.filter((session) => {
    const id = session.course_offerings?.program_id;
    if (programId !== "all" && id !== programId) return false;
    if (departmentId !== "all" && (!id || byId.get(id)?.department_id !== departmentId))
      return false;
    return true;
  });
}
