/**
 * Instructor availability enforcement policy (single source of truth).
 *
 * Domain rule (current operating decision):
 *   Every active instructor is considered AVAILABLE by default on every
 *   approved teaching day/period. Missing or incomplete
 *   `instructor_availability` rows must NEVER block scheduling.
 *
 * When `enforceInstructorAvailability` is switched on (after external
 * lecturers' days are entered), the previous behaviour returns unchanged:
 *   - mandatory-availability categories require rows for the day,
 *   - positive hard windows act as a whitelist,
 *   - `unavailable` rows act as a blacklist.
 *
 * The database mirrors this flag per college through
 * `public.scheduling_settings.enforce_instructor_availability`
 * (default false) which gates `_ss_iavail_req` / `_ss_iavail_win`.
 *
 * Nothing here relaxes any other hard constraint: instructor double-booking,
 * room conflicts, delivery-group/cohort shared-student conflicts, room type,
 * capacity, templates, breaks and settings all stay enforced.
 */

/** Current default: availability constraints are NOT enforced. */
export const ENFORCE_INSTRUCTOR_AVAILABILITY = false;

export function isInstructorAvailabilityEnforced(override?: boolean | null | undefined): boolean {
  return override ?? ENFORCE_INSTRUCTOR_AVAILABILITY;
}
