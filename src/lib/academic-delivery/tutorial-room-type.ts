/**
 * TUTORIAL-LECTURE-HALL-PERMANENT-RULE-01
 *
 * Platform-wide rule: a `tutorial` plan component (تمارين) is always delivered in a
 * `lecture_hall` room type — never a computer_lab or any other lab. `practical` and
 * `project` components keep their own room types untouched.
 *
 * Pure logic mirror of the DB triggers (`enforce_tutorial_lecture_hall_component`,
 * `enforce_tutorial_lecture_hall_assignment`). No DB access here.
 */

export const TUTORIAL_ROOM_TYPE_CODE = "lecture_hall";

export type TutorialRoomTypeCandidate = {
  id: string;
  code?: string | null;
  college_id?: string | null;
  is_active?: boolean | null;
  default_capacity?: number | null;
};

export type TutorialRoomTypeError =
  | "TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL"
  | "TUTORIAL_LECTURE_HALL_ROOM_TYPE_MISSING";

export const TUTORIAL_ROOM_TYPE_ERROR_AR: Record<TutorialRoomTypeError, string> = {
  TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL:
    "مكوّن التمارين يجب أن يكون في قاعة محاضرات ولا يمكن ربطه بمعمل.",
  TUTORIAL_LECTURE_HALL_ROOM_TYPE_MISSING:
    "لا يوجد نوع قاعة محاضرات نشط في هذه الكلية لربط مكوّن التمارين.",
};

export function normalizeRoomTypeCode(code: string | null | undefined): string {
  return String(code ?? "")
    .trim()
    .toLowerCase();
}

export function isLectureHallRoomTypeCode(code: string | null | undefined): boolean {
  return normalizeRoomTypeCode(code) === TUTORIAL_ROOM_TYPE_CODE;
}

/** Tutorial is the only component type governed by this rule. */
export function isTutorialComponentType(componentType: string | null | undefined): boolean {
  return String(componentType ?? "").trim() === "tutorial";
}

/** The college's schedulable lecture_hall room type, or null when none exists. */
export function findTutorialRoomType<T extends TutorialRoomTypeCandidate>(
  roomTypes: readonly T[],
  collegeId: string,
): T | null {
  const match = roomTypes.find(
    (r) =>
      isLectureHallRoomTypeCode(r.code) &&
      (r.college_id == null || r.college_id === collegeId) &&
      r.is_active !== false &&
      (r.default_capacity == null || r.default_capacity > 0),
  );
  return match ?? null;
}

export type TutorialRoomTypeResolution =
  | { ok: true; requiredRoomTypeId: string | null; corrected: boolean }
  | { ok: false; errorCode: TutorialRoomTypeError; message: string };

/**
 * Deterministic contract: tutorial + lecture_hall is kept, tutorial + anything else is
 * REJECTED, tutorial + nothing is auto-bound to the college lecture_hall.
 * Non-tutorial components pass through unchanged.
 */
export function resolveTutorialRoomTypeId(input: {
  componentType: string;
  requiredRoomTypeId: string | null | undefined;
  roomTypes: readonly TutorialRoomTypeCandidate[];
  collegeId: string;
}): TutorialRoomTypeResolution {
  const current = input.requiredRoomTypeId ?? null;
  if (!isTutorialComponentType(input.componentType)) {
    return { ok: true, requiredRoomTypeId: current, corrected: false };
  }

  if (current) {
    const row = input.roomTypes.find((r) => r.id === current);
    if (row && isLectureHallRoomTypeCode(row.code)) {
      return { ok: true, requiredRoomTypeId: current, corrected: false };
    }
    return {
      ok: false,
      errorCode: "TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL",
      message: TUTORIAL_ROOM_TYPE_ERROR_AR.TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL,
    };
  }

  const lectureHall = findTutorialRoomType(input.roomTypes, input.collegeId);
  if (!lectureHall) {
    return {
      ok: false,
      errorCode: "TUTORIAL_LECTURE_HALL_ROOM_TYPE_MISSING",
      message: TUTORIAL_ROOM_TYPE_ERROR_AR.TUTORIAL_LECTURE_HALL_ROOM_TYPE_MISSING,
    };
  }
  return { ok: true, requiredRoomTypeId: lectureHall.id, corrected: true };
}

/** Assignment-level mirror: tutorial assignments always require lecture_hall rooms. */
export function resolveTutorialAssignmentRoomType(input: {
  componentType: string;
  requiredRoomType: string | null | undefined;
}):
  | { ok: true; requiredRoomType: string | null }
  | { ok: false; errorCode: "TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL"; message: string } {
  const current = input.requiredRoomType ?? null;
  if (!isTutorialComponentType(input.componentType)) {
    return { ok: true, requiredRoomType: current };
  }
  if (current && !isLectureHallRoomTypeCode(current)) {
    return {
      ok: false,
      errorCode: "TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL",
      message: TUTORIAL_ROOM_TYPE_ERROR_AR.TUTORIAL_ROOM_TYPE_MUST_BE_LECTURE_HALL,
    };
  }
  return { ok: true, requiredRoomType: TUTORIAL_ROOM_TYPE_CODE };
}

/** True when the editor must lock the room type selector to lecture_hall. */
export function tutorialRoomTypeIsLocked(componentType: string | null | undefined): boolean {
  return isTutorialComponentType(componentType);
}
