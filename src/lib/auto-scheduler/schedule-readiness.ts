import { planRemainingSessions, type ExistingSessionLite } from "./session-plan.ts";

export interface RequiredAssignment {
  id: string;
  groupId: string;
  requiredDurations: number[];
  blocked: boolean;
}

/** A complete schedule needs every required session, not merely zero failed writes. */
export function assessScheduleReadiness(input: {
  assignments: RequiredAssignment[];
  sessions: (ExistingSessionLite & {
    teaching_assignment_id: string | null;
    delivery_group_id: string | null;
  })[];
  levelsOverFive: number;
  hardConflicts: number;
  softConflicts: number;
  cancelled: boolean;
}) {
  let requiredSessions = 0,
    requiredMinutes = 0,
    remainingSessions = 0,
    nonconformingSessions = 0,
    blockedAssignments = 0;
  for (const assignment of input.assignments) {
    if (assignment.blocked || !assignment.requiredDurations.length) blockedAssignments++;
    requiredSessions += assignment.requiredDurations.length;
    requiredMinutes += assignment.requiredDurations.reduce((n, hours) => n + hours * 60, 0);
    if (!assignment.requiredDurations.length) continue;
    const reconciliation = planRemainingSessions({
      requiredDurations: assignment.requiredDurations,
      existing: input.sessions.filter(
        (s) =>
          s.teaching_assignment_id === assignment.id && s.delivery_group_id === assignment.groupId,
      ),
    });
    remainingSessions += reconciliation.remaining.length;
    nonconformingSessions += reconciliation.nonconforming.length;
  }
  return {
    complete:
      input.assignments.length > 0 &&
      requiredSessions > 0 &&
      !input.cancelled &&
      !blockedAssignments &&
      !remainingSessions &&
      !nonconformingSessions &&
      !input.levelsOverFive &&
      !input.hardConflicts &&
      !input.softConflicts,
    requiredSessions,
    requiredMinutes,
    remainingSessions,
    nonconformingSessions,
    blockedAssignments,
    empty: input.assignments.length === 0,
  };
}
