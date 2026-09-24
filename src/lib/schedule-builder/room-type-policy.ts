/**
 * General room-type eligibility for scheduling.
 * required_room_type (when set and consistent) wins; session_type provides defaults.
 * Never auto-correct mismatched master data.
 */

export type SessionTypeKind = "lecture" | "theory" | "lab" | "practical" | "other";

export function classifySessionType(sessionType: string | null | undefined): SessionTypeKind {
  const t = String(sessionType ?? "")
    .toLowerCase()
    .trim();
  if (t === "lecture" || t === "theory") return t === "theory" ? "theory" : "lecture";
  if (t === "lab" || t === "practical") return t === "practical" ? "practical" : "lab";
  return "other";
}

/** Default preferred room types from session_type when required_room_type is absent. */
export function preferredRoomTypesForSessionType(sessionType: string | null | undefined): string[] {
  const kind = classifySessionType(sessionType);
  if (kind === "lecture" || kind === "theory") return ["lecture_hall"];
  if (kind === "lab" || kind === "practical") return ["computer_lab"];
  return [];
}

export function roomMatchesPreferredTypes(
  roomType: string | null | undefined,
  preferred: string[],
): boolean {
  if (!preferred.length) return true;
  return preferred.includes(String(roomType ?? ""));
}

/**
 * Effective required type: TA required_room_type takes priority when present.
 * Returns null when no requirement is known (caller may still filter by session defaults).
 */
export function resolveRequiredRoomType(params: {
  requiredRoomType?: string | null;
  sessionType?: string | null;
}): { requiredType: string | null; source: "required_room_type" | "session_type" | "none" } {
  const required = params.requiredRoomType?.trim() || null;
  if (required) {
    return { requiredType: required, source: "required_room_type" };
  }
  const preferred = preferredRoomTypesForSessionType(params.sessionType);
  if (preferred[0]) {
    return { requiredType: preferred[0], source: "session_type" };
  }
  return { requiredType: null, source: "none" };
}

/**
 * Data-quality warning when session_type default and required_room_type disagree.
 * Does not auto-fix; caller should still enforce required_room_type for placement.
 */
export function sessionTypeRequiredRoomTypeConflict(params: {
  sessionType?: string | null;
  requiredRoomType?: string | null;
}): {
  conflict: boolean;
  sessionPreferred: string[];
  requiredRoomType: string | null;
} {
  const required = params.requiredRoomType?.trim() || null;
  const preferred = preferredRoomTypesForSessionType(params.sessionType);
  if (!required || !preferred.length) {
    return { conflict: false, sessionPreferred: preferred, requiredRoomType: required };
  }
  return {
    conflict: !preferred.includes(required),
    sessionPreferred: preferred,
    requiredRoomType: required,
  };
}

/** Filter live inventory — never hardcode hall/lab counts. */
export function filterRoomsByEligibility<
  T extends { room_type?: string | null; capacity?: number },
>(
  rooms: T[],
  params: {
    sessionType?: string | null;
    requiredRoomType?: string | null;
    minCapacity?: number;
  },
): T[] {
  const { requiredType } = resolveRequiredRoomType({
    requiredRoomType: params.requiredRoomType,
    sessionType: params.sessionType,
  });
  return rooms.filter((r) => {
    if (requiredType && r.room_type !== requiredType) return false;
    if (
      params.minCapacity != null &&
      typeof r.capacity === "number" &&
      r.capacity < params.minCapacity
    ) {
      return false;
    }
    return true;
  });
}

export function summarizeRoomInventory(
  rooms: Array<{ room_type?: string | null; capacity?: number | null; is_active?: boolean | null }>,
): {
  lectureHallCount: number;
  labCount: number;
  lectureHallCapacities: number[];
  labCapacities: number[];
} {
  const active = rooms.filter((r) => r.is_active !== false);
  const halls = active.filter((r) => r.room_type === "lecture_hall");
  const labs = active.filter(
    (r) => r.room_type === "computer_lab" || String(r.room_type ?? "").includes("lab"),
  );
  return {
    lectureHallCount: halls.length,
    labCount: labs.length,
    lectureHallCapacities: halls.map((r) => Number(r.capacity ?? 0)),
    labCapacities: labs.map((r) => Number(r.capacity ?? 0)),
  };
}
