/**
 * Merged-delivery semantics.
 *
 * One physical lecture may be recorded as more than one schedule row when it
 * serves several merged student groups (shared lecture / combined groups).
 * Those rows describe the SAME delivery: same course, same instructor, same
 * room, same day and same time window. Student membership overlap inside one
 * delivery is not a clash — the students sit in that single lecture once.
 *
 * A hard student conflict is only real when the same students are required in
 * two DIFFERENT overlapping deliveries.
 *
 * Pure module: no DB access, no writes.
 */

export interface DeliveryEntryRef {
  id?: string | null;
  course_offering_id?: string | null;
  instructor_id?: string | null;
  room_id?: string | null;
  day_of_week?: number | null;
  start_time?: string | null;
  end_time?: string | null;
}

const t = (v: string) => (v.length === 5 ? `${v}:00` : v);

const sameTime = (a: DeliveryEntryRef, b: DeliveryEntryRef) => {
  if (a.day_of_week == null || b.day_of_week == null) return false;
  if (a.day_of_week !== b.day_of_week) return false;
  if (!a.start_time || !a.end_time || !b.start_time || !b.end_time) return false;
  return t(a.start_time) === t(b.start_time) && t(a.end_time) === t(b.end_time);
};

/**
 * True when the two rows describe one and the same actual delivery (one real
 * lecture serving merged groups), so membership overlap between them must not
 * be reported as a hard conflict.
 */
export function isSameDeliveryEntry(a: DeliveryEntryRef, b: DeliveryEntryRef): boolean {
  if (a.id && b.id && a.id === b.id) return true;
  if (!sameTime(a, b)) return false;
  // Same physical delivery requires an identical instructor and room.
  if (!a.instructor_id || !b.instructor_id || a.instructor_id !== b.instructor_id) return false;
  if (!a.room_id || !b.room_id || a.room_id !== b.room_id) return false;
  // When the course identity is known on both sides it must match; two
  // different courses in one room at one time is a real room clash.
  const aCourse = a.course_offering_id ?? null;
  const bCourse = b.course_offering_id ?? null;
  if (aCourse !== null && bCourse !== null && aCourse !== bCourse) return false;
  return true;
}
