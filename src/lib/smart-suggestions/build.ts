/**
 * Read-only smart suggestions for unscheduled / problematic sessions.
 * Mission: UNSCHEDULED-SMART-SUGGESTIONS-01 — never auto-applies.
 */

export interface SuggestionSession {
  id: string;
  instructor_id: string | null;
  room_id: string | null;
  cohort_id?: string | null;
  delivery_group_id?: string | null;
  study_system: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  expected_students?: number | null;
  college_id?: string | null;
  academic_term_id?: string | null;
}

export interface SuggestionSlot {
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string;
  instructor_id: string;
}

export interface RoomCandidate {
  id: string;
  capacity?: number | null;
  room_type_id?: string | null;
}

export interface UnscheduledItem {
  id: string;
  study_system: string | null;
  instructor_id?: string | null;
  cohort_id?: string | null;
  delivery_group_id?: string | null;
  expected_students?: number | null;
  required_room_type_id?: string | null;
  duration_minutes?: number;
  reason_ar?: string;
  college_id?: string | null;
  academic_term_id?: string | null;
}

export interface SuggestionAlternative {
  slot: SuggestionSlot;
  quality: number;
  impact_ar: string;
  rejected_others_ar: string[];
}

export interface SmartSuggestion {
  item_id: string;
  exact_reason_ar: string;
  alternatives: SuggestionAlternative[];
  preview_only: true;
  auto_apply: false;
}

const normalize = (t: string) => (t.length === 5 ? `${t}:00` : t);
const mins = (t: string) => {
  const [h, m] = normalize(t).split(":").map(Number);
  return h * 60 + m;
};
const overlap = (aS: string, aE: string, bS: string, bE: string) =>
  normalize(aS) < normalize(bE) && normalize(bS) < normalize(aE);

const DEFAULT_SLOTS: Array<{ day: number; start: string; end: string }> = [
  { day: 0, start: "08:00", end: "10:00" },
  { day: 0, start: "10:00", end: "12:00" },
  { day: 1, start: "08:00", end: "10:00" },
  { day: 1, start: "10:00", end: "12:00" },
  { day: 2, start: "08:00", end: "10:00" },
  { day: 3, start: "08:00", end: "10:00" },
  { day: 4, start: "08:00", end: "10:00" },
];

function conflictsWith(
  proposed: SuggestionSlot,
  existing: SuggestionSession[],
  studySystem: string | null,
): string | null {
  for (const s of existing) {
    if ((s.study_system ?? "") !== (studySystem ?? "")) continue;
    if (s.day_of_week !== proposed.day_of_week) continue;
    if (!overlap(proposed.start_time, proposed.end_time, s.start_time, s.end_time)) continue;
    if (s.instructor_id && s.instructor_id === proposed.instructor_id) {
      return "تعارض مدرس في نفس الوقت والنظام";
    }
    if (s.room_id && s.room_id === proposed.room_id) {
      return "تعارض قاعة في نفس الوقت والنظام";
    }
    if (s.cohort_id && s.delivery_group_id === undefined && s.cohort_id) {
      /* cohort check below */
    }
  }
  for (const s of existing) {
    if ((s.study_system ?? "") !== (studySystem ?? "")) continue;
    if (s.day_of_week !== proposed.day_of_week) continue;
    if (!overlap(proposed.start_time, proposed.end_time, s.start_time, s.end_time)) continue;
    if (s.cohort_id && proposed.instructor_id) {
      // cohort conflict only if same cohort tracked on proposed via external id — skip without id
    }
  }
  return null;
}

/**
 * Build explanatory suggestions. Never mutates sessions. Never writes.
 */
export function buildSmartSuggestions(input: {
  unscheduled: UnscheduledItem[];
  existingSessions: SuggestionSession[];
  rooms: RoomCandidate[];
  collegeId?: string;
}): SmartSuggestion[] {
  const sessions = input.collegeId
    ? input.existingSessions.filter((s) => !s.college_id || s.college_id === input.collegeId)
    : input.existingSessions;
  const items = input.collegeId
    ? input.unscheduled.filter((u) => !u.college_id || u.college_id === input.collegeId)
    : input.unscheduled;

  const out: SmartSuggestion[] = [];
  for (const item of items) {
    const instructor = item.instructor_id ?? "UNASSIGNED";
    const reason =
      item.reason_ar ??
      (instructor === "UNASSIGNED"
        ? "لا يوجد مدرس مسند — لا يمكن اقتراح وقت آمن"
        : "عنصر غير مجدول — البحث عن وقت/قاعة بلا تعارض");

    const rejected: string[] = [];
    const alts: SuggestionAlternative[] = [];

    if (instructor === "UNASSIGNED") {
      out.push({
        item_id: item.id,
        exact_reason_ar: reason,
        alternatives: [],
        preview_only: true,
        auto_apply: false,
      });
      continue;
    }

    const rooms = input.rooms.filter((r) => {
      if (
        item.required_room_type_id &&
        r.room_type_id &&
        r.room_type_id !== item.required_room_type_id
      ) {
        rejected.push(`قاعة ${r.id}: نوع غير مطابق`);
        return false;
      }
      if (
        item.expected_students != null &&
        r.capacity != null &&
        item.expected_students > r.capacity
      ) {
        rejected.push(`قاعة ${r.id}: السعة ${r.capacity} < ${item.expected_students}`);
        return false;
      }
      return true;
    });

    for (const slot of DEFAULT_SLOTS) {
      for (const room of rooms.slice(0, 8)) {
        const proposed: SuggestionSlot = {
          day_of_week: slot.day,
          start_time: slot.start,
          end_time: slot.end,
          room_id: room.id,
          instructor_id: instructor,
        };
        const conflict = conflictsWith(proposed, sessions, item.study_system);
        if (conflict) {
          rejected.push(`${slot.day} ${slot.start}: ${conflict}`);
          continue;
        }
        const quality = 80 - alts.length * 5;
        alts.push({
          slot: proposed,
          quality: Math.max(40, quality),
          impact_ar: `لا تعارض ظاهر على المدرس/القاعة ضمن ${item.study_system ?? "النظام"}؛ أثر على دفعة ${item.cohort_id ?? "—"}`,
          rejected_others_ar: rejected.slice(-5),
        });
        if (alts.length >= 3) break;
      }
      if (alts.length >= 3) break;
    }

    out.push({
      item_id: item.id,
      exact_reason_ar: reason,
      alternatives: alts,
      preview_only: true,
      auto_apply: false,
    });
  }
  return out;
}

export function assertPreviewHasNoWrites(source: string): boolean {
  return !/\.(insert|update|upsert|delete)\s*\(/.test(source);
}
