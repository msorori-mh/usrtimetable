/**
 * Canonical room types + legacy alias normalization for Excel import.
 * Internal keys stay English; aliases support older templates (LEC/LAB).
 */

export const CANONICAL_ROOM_TYPES = [
  "lecture_hall",
  "computer_lab",
  "network_lab",
  "cybersecurity_lab",
  "electronics_lab",
  "workshop",
  "seminar_room",
] as const;

export type CanonicalRoomType = (typeof CANONICAL_ROOM_TYPES)[number];

/** Documented / historically used short codes → canonical slug. */
export const ROOM_TYPE_CODE_ALIASES: Record<string, CanonicalRoomType> = {
  lec: "lecture_hall",
  lab: "computer_lab",
  // Historical migration aliases (20260630232652)
  lecture: "lecture_hall",
  networking_lab: "network_lab",
};

export const CANONICAL_ROOM_TYPES_AR =
  "lecture_hall, computer_lab, network_lab, cybersecurity_lab, electronics_lab, workshop, seminar_room";

export function normalizeToken(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  return s.toLowerCase().replace(/\s+/g, "_");
}

export function isCanonicalRoomType(value: string): value is CanonicalRoomType {
  return (CANONICAL_ROOM_TYPES as readonly string[]).includes(value);
}

export function resolveAliasToCanonical(token: string): CanonicalRoomType | null {
  if (isCanonicalRoomType(token)) return token;
  return ROOM_TYPE_CODE_ALIASES[token] ?? null;
}

export type RoomTypeResolveOk = {
  ok: true;
  roomType: CanonicalRoomType;
  source: "room_type" | "room_type_code" | "both";
};

export type RoomTypeResolveErr = {
  ok: false;
  errorCode: "unknown_room_type" | "conflicting_room_type" | "missing_room_type";
  message: string;
  columnName: string;
  rawValue?: string;
};

export type RoomTypeResolveResult = RoomTypeResolveOk | RoomTypeResolveErr;

/**
 * Priority:
 * 1. نوع_القاعة valid canonical → use it
 * 2. نوع_القاعة empty + نوع_القاعة_رمز alias/canonical → use alias
 * 3. both present and compatible → accept
 * 4. both present and conflicting → reject
 */
export function resolveRoomTypeFields(
  roomTypeRaw: string | null | undefined,
  roomTypeCodeRaw: string | null | undefined,
): RoomTypeResolveResult {
  const typeTok = normalizeToken(roomTypeRaw);
  const codeTok = normalizeToken(roomTypeCodeRaw);

  const fromType = typeTok ? resolveAliasToCanonical(typeTok) : null;
  const fromCode = codeTok ? resolveAliasToCanonical(codeTok) : null;

  if (typeTok && !fromType) {
    return {
      ok: false,
      errorCode: "unknown_room_type",
      columnName: "نوع_القاعة",
      message: `نوع قاعة غير معروف: ${roomTypeRaw}. القيم المقبولة: ${CANONICAL_ROOM_TYPES_AR}`,
      rawValue: String(roomTypeRaw),
    };
  }

  if (codeTok && !fromCode) {
    return {
      ok: false,
      errorCode: "unknown_room_type",
      columnName: "نوع_القاعة_رمز",
      message: `نوع قاعة غير معروف: ${roomTypeCodeRaw}. القيم المقبولة: ${CANONICAL_ROOM_TYPES_AR} (أو الرموز القديمة LEC / LAB)`,
      rawValue: String(roomTypeCodeRaw),
    };
  }

  if (fromType && fromCode && fromType !== fromCode) {
    return {
      ok: false,
      errorCode: "conflicting_room_type",
      columnName: "نوع_القاعة",
      message: "يوجد تعارض بين نوع القاعة ورمز نوع القاعة.",
      rawValue: `${roomTypeRaw} / ${roomTypeCodeRaw}`,
    };
  }

  if (fromType) {
    return {
      ok: true,
      roomType: fromType,
      source: fromCode ? "both" : "room_type",
    };
  }

  if (fromCode) {
    return {
      ok: true,
      roomType: fromCode,
      source: "room_type_code",
    };
  }

  // Both empty — room type is mandatory; never invent a default.
  return {
    ok: false,
    errorCode: "missing_room_type",
    columnName: "نوع_القاعة",
    message:
      "نوع القاعة مطلوب. أدخل قيمة في حقل نوع_القاعة، أو استخدم رمزًا قديمًا معتمدًا في نوع_القاعة_رمز.",
  };
}
