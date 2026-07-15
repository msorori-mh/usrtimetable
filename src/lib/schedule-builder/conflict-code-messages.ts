/**
 * Central Arabic/English mapping for schedule-session conflict codes.
 * DB RPCs return codes (+ metadata) only; UI resolves display text here.
 */

export type ConflictMessageMeta = Record<string, unknown> | null | undefined;

const AR: Record<string, string> = {
  instructor_conflict: "تعارض المحاضر: نفس المحاضر لديه محاضرة أخرى في نفس الوقت.",
  room_conflict: "تعارض القاعة: نفس القاعة محجوزة في نفس الوقت.",
  section_conflict: "تعارض المجموعة: نفس المجموعة لديها محاضرة أخرى في نفس الوقت.",
  subgroup_conflict: "تعارض المجموعة الفرعية: نفس المجموعة الفرعية لديها جلسة متداخلة.",
  room_college_mismatch: "القاعة غير صالحة أو لا تنتمي إلى الكلية النشطة.",
  room_capacity: "سعة القاعة غير كافية للعدد المعتمد.",
  room_capacity_exceeded: "سعة القاعة غير كافية للعدد المعتمد.",
  room_capacity_unverified: "تحذير سعة: العدد غير معتمد.",
  room_type_mismatch: "نوع القاعة لا يطابق المطلوب.",
  room_availability: "المحاضرة خارج نطاق توفّر القاعة المحدد.",
  instructor_availability_required: "توفّر المحاضر إلزامي لهذه الفئة وغير معرّف.",
  instructor_availability: "المحاضرة خارج نطاق توفّر المحاضر الإلزامي.",
  instructor_unavailable: "المحاضرة خارج نطاق توفّر المحاضر الإلزامي.",
  study_system_time_template: "المحاضرة خارج قوالب أوقات المحاضرات المسموحة لنظام الدراسة.",
  invalid_study_system: "نظام الدراسة غير صالح لهذه الجلسة.",
  outside_working_days: "اليوم المقترح خارج أيام العمل المعتمدة للكلية.",
  outside_working_hours: "الوقت المقترح خارج ساعات الدوام المعتمدة.",
  daily_break: "التعارض مع استراحة يومية.",
  daily_break_conflict: "التعارض مع استراحة يومية.",
  STALE_SESSION: "تغيرت الجلسة منذ تحميلها. أعد التحميل ثم حاول مجدداً.",
  stale_session: "تغيرت الجلسة منذ تحميلها. أعد التحميل ثم حاول مجدداً.",
  VERSION_LOCKED: "هذه النسخة غير قابلة للتعديل.",
  schedule_locked: "هذه النسخة غير قابلة للتعديل.",
  SESSION_LOCKED: "هذه الجلسة مقفلة.",
  NOT_FOUND: "الجلسة غير موجودة.",
  FORBIDDEN_COLLEGE: "لا تملك صلاحية إدارة هذه الكلية.",
  INVALID_TIME_RANGE: "نطاق الوقت غير صالح.",
  BLOCKED_CONFLICTS: "توجد تعارضات أو قيود تمنع الحفظ.",
  BLOCKED_WARNINGS: "توجد تحذيرات تمنع الحفظ.",
  RPC_ERROR: "فشل الاتصال أثناء فحص التعارضات.",
};

const EN: Record<string, string> = {
  instructor_conflict: "Instructor conflict: same instructor has another overlapping session.",
  room_conflict: "Room conflict: same room is booked at the same time.",
  section_conflict: "Section conflict: same section has another overlapping session.",
  subgroup_conflict: "Subgroup conflict: same subgroup has another overlapping session.",
  room_college_mismatch: "Room is invalid or not in the active college.",
  room_capacity: "Room capacity insufficient for confirmed enrollment.",
  room_capacity_exceeded: "Room capacity insufficient for confirmed enrollment.",
  room_capacity_unverified: "Capacity warning: enrollment count is not confirmed.",
  room_type_mismatch: "Room type mismatch.",
  room_availability: "Session outside room's defined availability window.",
  instructor_availability_required:
    "Instructor availability is mandatory for this category and not defined.",
  instructor_availability: "Session outside instructor's hard availability window.",
  instructor_unavailable: "Session outside instructor's hard availability window.",
  study_system_time_template: "Session outside allowed time-slot templates for the study system.",
  invalid_study_system: "Invalid study system for this session.",
  outside_working_days: "Proposed day is outside configured working days.",
  outside_working_hours: "Proposed time is outside configured working hours.",
  daily_break: "Overlaps a daily break.",
  daily_break_conflict: "Overlaps a daily break.",
  STALE_SESSION: "Session changed since it was loaded. Reload and try again.",
  stale_session: "Session changed since it was loaded. Reload and try again.",
  VERSION_LOCKED: "This schedule version is not editable.",
  schedule_locked: "This schedule version is not editable.",
  SESSION_LOCKED: "This session is locked.",
  NOT_FOUND: "Session not found.",
  FORBIDDEN_COLLEGE: "You do not have permission to manage this college.",
  INVALID_TIME_RANGE: "Invalid time range.",
  BLOCKED_CONFLICTS: "Conflicts or constraints prevent saving.",
  BLOCKED_WARNINGS: "Warnings prevent saving.",
  RPC_ERROR: "Failed to reach conflict validation.",
};

function metaNum(meta: ConflictMessageMeta, key: string): number | null {
  const v = meta?.[key];
  return typeof v === "number" ? v : null;
}

function metaStr(meta: ConflictMessageMeta, key: string): string | null {
  const v = meta?.[key];
  return typeof v === "string" ? v : null;
}

/** Resolve Arabic message for a conflict/RPC code. */
export function conflictMessageAr(code: string, meta?: ConflictMessageMeta): string {
  if (code === "room_capacity" || code === "room_capacity_exceeded") {
    const cap = metaNum(meta, "capacity");
    const n = metaNum(meta, "expected_students");
    if (cap != null && n != null) {
      return `سعة القاعة غير كافية للعدد المعتمد: السعة ${cap} (+5) والعدد ${n}.`;
    }
  }
  if (code === "room_capacity_unverified") {
    const st = metaStr(meta, "enrollment_count_status") ?? "unverified";
    const cap = metaNum(meta, "capacity");
    const n = metaNum(meta, "expected_students");
    if (cap != null && n != null) {
      return `تحذير سعة: العدد غير معتمد (${st}). السعة ${cap} (+5) والعدد ${n}.`;
    }
  }
  if (code === "room_type_mismatch") {
    const req = metaStr(meta, "required_room_type");
    const got = metaStr(meta, "room_type") ?? "unknown";
    if (req) return `نوع القاعة لا يطابق المطلوب: المطلوب ${req} والقاعة ${got}.`;
  }
  if (code === "daily_break" || code === "daily_break_conflict") {
    const name = metaStr(meta, "name");
    if (name) return `التعارض مع استراحة يومية: ${name}.`;
  }
  return AR[code] ?? code;
}

/** Resolve English message for a conflict/RPC code. */
export function conflictMessageEn(code: string, meta?: ConflictMessageMeta): string {
  if (code === "room_capacity" || code === "room_capacity_exceeded") {
    const cap = metaNum(meta, "capacity");
    const n = metaNum(meta, "expected_students");
    if (cap != null && n != null) {
      return `Room capacity insufficient: capacity ${cap} (+5), count ${n}.`;
    }
  }
  if (code === "room_capacity_unverified") {
    const st = metaStr(meta, "enrollment_count_status") ?? "unverified";
    const cap = metaNum(meta, "capacity");
    const n = metaNum(meta, "expected_students");
    if (cap != null && n != null) {
      return `Capacity warning: enrollment status ${st}. capacity ${cap} (+5), count ${n}.`;
    }
  }
  if (code === "room_type_mismatch") {
    const req = metaStr(meta, "required_room_type");
    const got = metaStr(meta, "room_type") ?? "unknown";
    if (req) return `Room type mismatch: required ${req}, room is ${got}.`;
  }
  if (code === "daily_break" || code === "daily_break_conflict") {
    const name = metaStr(meta, "name");
    if (name) return `Overlaps daily break: ${name}.`;
  }
  return EN[code] ?? code;
}

export function enrichConflictMessages<T extends { code: string; metadata?: ConflictMessageMeta }>(
  conflict: T,
): T & { message_ar: string; message_en: string } {
  return {
    ...conflict,
    message_ar: conflictMessageAr(conflict.code, conflict.metadata),
    message_en: conflictMessageEn(conflict.code, conflict.metadata),
  };
}
