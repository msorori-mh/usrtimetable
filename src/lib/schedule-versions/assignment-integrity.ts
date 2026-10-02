export interface AssignmentIntegritySession {
  id: string;
  teaching_assignment_id: string | null;
  instructor_id: string | null;
  replaced_by_split?: boolean | null;
}

export interface AssignmentIntegrityAssignment {
  id: string;
  instructor_id: string | null;
  is_active: boolean | null;
}

/** Linked sessions must describe the assignment they actually reference.
 * An active replacement for the same group cannot validate an old session.
 * Legacy sessions without an assignment retain their existing coverage rules.
 */
export function findSessionAssignmentIssues(
  sessions: readonly AssignmentIntegritySession[],
  assignments: readonly AssignmentIntegrityAssignment[],
) {
  const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
  return sessions.flatMap((session) => {
    if (session.replaced_by_split || !session.teaching_assignment_id) return [];
    const assignment = byId.get(session.teaching_assignment_id);
    const code = !assignment
      ? "missing_assignment"
      : assignment.is_active !== true
        ? "inactive_assignment"
        : assignment.instructor_id !== session.instructor_id
          ? "instructor_mismatch"
          : null;
    return code
      ? [{ sessionId: session.id, assignmentId: session.teaching_assignment_id, code }]
      : [];
  });
}

export function assignmentIntegrityReason(count: number) {
  return `عدد الجلسات المرتبطة بإسنادات ملغاة أو غير متاحة أو لا تطابق محاضريها: ${count}. صحّح ارتباط جلسات هذه النسخة بالإسناد الحالي، ثم أعد فحص التعارضات قبل الاعتماد أو النشر.`;
}
