/**
 * Room-type compatibility policy — mirrors the database helper
 * `public.is_assignment_room_compatible(college_id, teaching_assignment_id, room_id)`
 * and the `_ss_room_type` conflict rule.
 *
 * Policy (scheduling-time only — no stored `required_room_type` is ever changed):
 *  - `practical` component that requires `computer_lab` may use:
 *      1. `computer_lab`  → preferred (rank 0);
 *      2. `lecture_hall`  → fallback only (rank 1), used when it is the only way
 *         to place a session that would otherwise stay unscheduled.
 *  - every other combination stays a hard exact match: theory/tutorial never
 *    borrow a `computer_lab`, and any other required room type is exact.
 */

export const COMPUTER_LAB_TYPE = "computer_lab";
export const LECTURE_HALL_TYPE = "lecture_hall";
export const PRACTICAL_COMPONENT = "practical";

/** rank 0 = required/preferred type, 1 = policy fallback, null = incompatible. */
export type RoomTypeRank = 0 | 1 | null;

const norm = (value: string | null | undefined): string =>
  String(value ?? "")
    .trim()
    .toLowerCase();

/** Practical component aliases used across imports and legacy session types. */
const PRACTICAL_ALIASES = new Set([
  "practical",
  "lab",
  "laboratory",
  "عملي",
  "معمل",
  "مختبر",
]);

export function isPracticalComponent(componentType: string | null | undefined): boolean {
  return PRACTICAL_ALIASES.has(norm(componentType));
}

/**
 * True when a practical component requiring `computer_lab` may fall back to the
 * given room type (`lecture_hall` only).
 */
export function isPracticalLabFallback(input: {
  componentType?: string | null;
  requiredRoomType?: string | null;
  roomType?: string | null;
}): boolean {
  return (
    isPracticalComponent(input.componentType) &&
    norm(input.requiredRoomType) === COMPUTER_LAB_TYPE &&
    norm(input.roomType) === LECTURE_HALL_TYPE
  );
}

/**
 * Compatibility rank of a room type against the requirement.
 * Fail-open only where the database does: an unknown requirement is no constraint.
 */
export function roomTypeRank(input: {
  componentType?: string | null;
  requiredRoomType?: string | null;
  roomType?: string | null;
}): RoomTypeRank {
  const required = norm(input.requiredRoomType);
  if (!required) return 0;
  if (norm(input.roomType) === required) return 0;
  return isPracticalLabFallback(input) ? 1 : null;
}

/** Same decision as the database helper, as a boolean. */
export function isRoomTypeCompatible(input: {
  componentType?: string | null;
  requiredRoomType?: string | null;
  roomType?: string | null;
}): boolean {
  return roomTypeRank(input) !== null;
}

/** Ordered room types to try for a requirement: preferred first, fallback last. */
export function orderedRoomTypePreference(input: {
  componentType?: string | null;
  requiredRoomType?: string | null;
}): string[] {
  const required = norm(input.requiredRoomType);
  if (!required) return [];
  if (isPracticalComponent(input.componentType) && required === COMPUTER_LAB_TYPE) {
    return [COMPUTER_LAB_TYPE, LECTURE_HALL_TYPE];
  }
  return [required];
}

/** Arabic audit note for a placement that used the lecture-hall fallback. */
export const PRACTICAL_ROOM_FALLBACK_NOTE_AR =
  "تم تسكين جلسة عملية في قاعة محاضرات كبديل مسموح لعدم توفر معمل صالح في ذلك الوقت.";
