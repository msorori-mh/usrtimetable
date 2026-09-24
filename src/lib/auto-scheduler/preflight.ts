import {
  availabilityStatusLabelAr,
  canReceiveNewWork,
} from "../instructor-metadata.ts";

export interface SchedulingInstructorStatus {
  id: string;
  full_name?: string | null;
  availability_status?: string | null;
}

export interface InstructorWorkItem {
  instructor_id: string;
}

export interface UnavailableInstructorBlocker {
  id: string;
  name: string;
  status: string | null;
  statusLabel: string;
}

/**
 * Reject only instructors referenced by new work items. Existing sessions stay
 * untouched and remain valid historical records.
 */
export function unavailableInstructorBlockers(
  instructors: readonly SchedulingInstructorStatus[],
  workItems: readonly InstructorWorkItem[],
): UnavailableInstructorBlocker[] {
  const requiredIds = new Set(
    workItems.map((item) => item.instructor_id).filter(Boolean),
  );
  return instructors
    .filter(
      (instructor) =>
        requiredIds.has(instructor.id) &&
        !canReceiveNewWork(instructor.availability_status),
    )
    .map((instructor) => ({
      id: instructor.id,
      name: instructor.full_name?.trim() || instructor.id,
      status: instructor.availability_status ?? null,
      statusLabel: availabilityStatusLabelAr(instructor.availability_status),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

export function assertInstructorsAvailableForNewScheduling(
  instructors: readonly SchedulingInstructorStatus[],
  workItems: readonly InstructorWorkItem[],
): void {
  const blockers = unavailableInstructorBlockers(instructors, workItems);
  if (!blockers.length) return;
  const details = blockers
    .map((blocker) => `${blocker.name} (${blocker.statusLabel})`)
    .join("؛ ");
  throw new Error(
    `INSTRUCTOR_NOT_AVAILABLE: لا يمكن توليد محاضرات جديدة للمحاضرين: ${details}. حدّث الحالة أو الإسناد ثم أعد المحاولة.`,
  );
}
