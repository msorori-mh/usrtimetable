/**
 * Pure helpers for Schedule Builder local pending session changes (no DB writes).
 */
import type { WorkspaceSessionView } from "@/lib/schedule-builder/workspace";
import type { WorkspaceRoomOption } from "@/lib/schedule-builder/queries";
import type { GridSession } from "@/components/timetable/timetable-grid";
import { SESSION_TYPE_LABELS, SESSION_STUDY_SYSTEM_LABELS } from "@/lib/reports/session-mappers";
import { SCHEDULE_BUILDER_UNSAVED_BADGE_AR } from "@/lib/schedule-builder/edit-access";

export type PendingScheduleSlot = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string | null;
};

export type PendingScheduleSessionChange = {
  sessionId: string;
  expectedUpdatedAt: string | null;
  original: PendingScheduleSlot;
  proposed: PendingScheduleSlot;
  changeReason: string;
};

export type LocalEditFormValues = {
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string;
  changeReason: string;
};

export function normalizeTimeHHMM(value: string): string {
  const t = String(value ?? "").trim();
  if (/^\d{2}:\d{2}$/.test(t)) return t;
  if (/^\d{2}:\d{2}:\d{2}/.test(t)) return t.slice(0, 5);
  return t;
}

export function timeToMinutes(value: string): number | null {
  const t = normalizeTimeHHMM(value);
  const m = /^(\d{2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function addMinutesToTime(start: string, addMinutes: number): string | null {
  const base = timeToMinutes(start);
  if (base == null || !Number.isFinite(addMinutes)) return null;
  const total = base + addMinutes;
  if (total < 0) return null;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type DragDropProposalResult =
  | { ok: true; proposed: PendingScheduleSlot }
  | { ok: false; message: string };

/**
 * Drag-drop proposes a new day/start only.
 * Duration and room are preserved from the source slot; no DB write.
 */
export function proposeSlotFromDragDrop(opts: {
  sourceSlot: PendingScheduleSlot;
  day_of_week: number;
  start_time: string;
}): DragDropProposalResult {
  const start = normalizeTimeHHMM(opts.start_time);
  const startMins = timeToMinutes(start);
  if (startMins == null) return { ok: false, message: "وقت البداية غير صالح." };

  const sourceStart = timeToMinutes(opts.sourceSlot.start_time);
  const sourceEnd = timeToMinutes(opts.sourceSlot.end_time);
  if (sourceStart == null || sourceEnd == null) {
    return { ok: false, message: "مدة الجلسة غير صالحة." };
  }
  const duration = sourceEnd - sourceStart;
  if (duration <= 0) return { ok: false, message: "مدة الجلسة غير صالحة." };

  const end = addMinutesToTime(start, duration);
  if (!end) return { ok: false, message: "تعذّر حساب وقت النهاية." };

  const proposed: PendingScheduleSlot = {
    day_of_week: Number(opts.day_of_week),
    start_time: start,
    end_time: end,
    room_id: opts.sourceSlot.room_id ?? null,
  };

  if (slotsEqual(opts.sourceSlot, proposed)) {
    return { ok: false, message: "لا يوجد فرق عن القيم الحالية." };
  }

  return { ok: true, proposed };
}

export function snapshotOriginalFromSession(session: WorkspaceSessionView): PendingScheduleSlot {
  return {
    day_of_week: session.day_of_week,
    start_time: normalizeTimeHHMM(session.start_time),
    end_time: normalizeTimeHHMM(session.end_time),
    room_id: session.room_id,
  };
}

export function formValuesFromSession(session: WorkspaceSessionView): LocalEditFormValues {
  return {
    day_of_week: session.day_of_week,
    start_time: normalizeTimeHHMM(session.start_time),
    end_time: normalizeTimeHHMM(session.end_time),
    room_id: session.room_id ?? "",
    changeReason: "",
  };
}

export function slotsEqual(a: PendingScheduleSlot, b: PendingScheduleSlot): boolean {
  return (
    a.day_of_week === b.day_of_week &&
    normalizeTimeHHMM(a.start_time) === normalizeTimeHHMM(b.start_time) &&
    normalizeTimeHHMM(a.end_time) === normalizeTimeHHMM(b.end_time) &&
    (a.room_id ?? null) === (b.room_id ?? null)
  );
}

export function hasPendingChanges(pending: PendingScheduleSessionChange | null): boolean {
  if (!pending) return false;
  return !slotsEqual(pending.original, pending.proposed);
}

export type LocalEditValidationResult =
  | { ok: true; proposed: PendingScheduleSlot; changeReason: string }
  | { ok: false; message: string };

export function validateLocalEditForm(
  form: LocalEditFormValues,
  original: PendingScheduleSlot,
): LocalEditValidationResult {
  if (form.day_of_week == null || Number.isNaN(Number(form.day_of_week))) {
    return { ok: false, message: "اليوم مطلوب." };
  }
  const start = normalizeTimeHHMM(form.start_time);
  const end = normalizeTimeHHMM(form.end_time);
  if (!start) return { ok: false, message: "وقت البداية مطلوب." };
  if (!end) return { ok: false, message: "وقت النهاية مطلوب." };
  const sm = timeToMinutes(start);
  const em = timeToMinutes(end);
  if (sm == null || em == null) return { ok: false, message: "قيم الوقت غير صالحة." };
  if (em <= sm) return { ok: false, message: "وقت النهاية يجب أن يكون بعد البداية." };

  const proposed: PendingScheduleSlot = {
    day_of_week: Number(form.day_of_week),
    start_time: start,
    end_time: end,
    room_id: form.room_id ? form.room_id : null,
  };

  if (slotsEqual(original, proposed)) {
    return { ok: false, message: "لا يوجد فرق عن القيم الأصلية." };
  }

  return {
    ok: true,
    proposed,
    changeReason: form.changeReason.trim(),
  };
}

export function buildPendingChange(opts: {
  session: WorkspaceSessionView;
  proposed: PendingScheduleSlot;
  changeReason: string;
}): PendingScheduleSessionChange {
  return {
    sessionId: opts.session.id,
    expectedUpdatedAt: opts.session.updated_at,
    original: snapshotOriginalFromSession(opts.session),
    proposed: opts.proposed,
    changeReason: opts.changeReason,
  };
}

export function applyPendingToSessions(
  sessions: WorkspaceSessionView[],
  pending: PendingScheduleSessionChange | null,
  rooms: WorkspaceRoomOption[],
): WorkspaceSessionView[] {
  if (!pending || !hasPendingChanges(pending)) return sessions;
  return sessions.map((s) => {
    if (s.id !== pending.sessionId) return s;
    const room = rooms.find((r) => r.id === pending.proposed.room_id);
    const room_label = pending.proposed.room_id
      ? room
        ? `${room.code}${room.name ? ` — ${room.name}` : ""}`
        : s.room_label
      : "—";
    return {
      ...s,
      day_of_week: pending.proposed.day_of_week,
      start_time: pending.proposed.start_time,
      end_time: pending.proposed.end_time,
      room_id: pending.proposed.room_id,
      room_label,
    };
  });
}

export function toGridSessionsWithPending(
  sessions: WorkspaceSessionView[],
  pending: PendingScheduleSessionChange | null,
  selectedSessionId: string | null,
): GridSession[] {
  return sessions.map((s) => {
    const typeAr = SESSION_TYPE_LABELS[s.session_type] ?? s.session_type;
    const sysAr = SESSION_STUDY_SYSTEM_LABELS[s.study_system] ?? s.study_system;
    const start = String(s.start_time).slice(0, 5);
    const end = String(s.end_time).slice(0, 5);
    const isPending = !!pending && hasPendingChanges(pending) && pending.sessionId === s.id;
    const isSelected = selectedSessionId === s.id;
    const badges = [`${typeAr} · ${sysAr}`];
    if (isPending) badges.push(SCHEDULE_BUILDER_UNSAVED_BADGE_AR);
    if (isSelected) badges.push("محدد");
    return {
      id: s.id,
      day_of_week: s.day_of_week,
      start_time: s.start_time,
      end_time: s.end_time,
      study_system: s.study_system,
      session_type: s.session_type,
      title: `${isPending ? "◌ " : ""}${s.course_code} · ش${s.section_number}`,
      subtitle: `${s.instructor_name} · ${s.room_label} · ${start}–${end}`,
      badge: badges.join(" · "),
    };
  });
}

export type BeforeAfterRow = { field: string; before: string; after: string };

export function buildBeforeAfterRows(
  pending: PendingScheduleSessionChange,
  dayLabel: (d: number) => string,
  roomLabel: (id: string | null) => string,
): BeforeAfterRow[] {
  const rows: BeforeAfterRow[] = [];
  if (pending.original.day_of_week !== pending.proposed.day_of_week) {
    rows.push({
      field: "اليوم",
      before: dayLabel(pending.original.day_of_week),
      after: dayLabel(pending.proposed.day_of_week),
    });
  }
  if (
    normalizeTimeHHMM(pending.original.start_time) !==
    normalizeTimeHHMM(pending.proposed.start_time)
  ) {
    rows.push({
      field: "البداية",
      before: normalizeTimeHHMM(pending.original.start_time),
      after: normalizeTimeHHMM(pending.proposed.start_time),
    });
  }
  if (
    normalizeTimeHHMM(pending.original.end_time) !== normalizeTimeHHMM(pending.proposed.end_time)
  ) {
    rows.push({
      field: "النهاية",
      before: normalizeTimeHHMM(pending.original.end_time),
      after: normalizeTimeHHMM(pending.proposed.end_time),
    });
  }
  if ((pending.original.room_id ?? null) !== (pending.proposed.room_id ?? null)) {
    rows.push({
      field: "القاعة",
      before: roomLabel(pending.original.room_id),
      after: roomLabel(pending.proposed.room_id),
    });
  }
  return rows;
}
