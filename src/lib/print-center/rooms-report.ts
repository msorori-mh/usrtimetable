/**
 * ROOMS-REPORT-PRINT-01 — pure summary + grouping for «تقرير القاعات».
 *
 * Summary: every active room/lab with type, capacity, used weekly hours, available
 * weekly hours, utilization and session count. Detail: one printable page per room.
 *
 * Available hours follow the same precedence the scheduler uses: a room's own
 * `room_availability` rows win when present, otherwise the college working window.
 * Read-only — nothing here writes scheduling data.
 */
import { hoursBetween } from "@/lib/reports/formatters";
import { groupPrintPages } from "./group";
import type { PrintPageGroup, PrintSessionLike } from "./types";

export const ROOMS_REPORT_TITLE_AR = "تقرير القاعات";

export interface RoomsReportRoom {
  id: string;
  code?: string | null;
  name?: string | null;
  capacity?: number | null;
  room_type_id?: string | null;
  is_active?: boolean | null;
}

export interface RoomsReportRoomType {
  id: string;
  name_ar?: string | null;
  name?: string | null;
  code?: string | null;
}

export interface RoomsReportAvailability {
  room_id: string;
  start_time?: string | null;
  end_time?: string | null;
}

export interface RoomsReportSettings {
  working_days?: number[] | null;
  day_start_time?: string | null;
  day_end_time?: string | null;
}

export interface RoomsReportSummaryRow {
  room_code: string;
  room_name: string;
  room_type: string;
  capacity: number | string;
  used_hours: number;
  available_hours: number;
  utilization: string;
  session_count: number;
}

export const ROOMS_REPORT_SUMMARY_HEADERS: { key: keyof RoomsReportSummaryRow; label: string }[] = [
  { key: "room_code", label: "الرمز" },
  { key: "room_name", label: "القاعة" },
  { key: "room_type", label: "النوع" },
  { key: "capacity", label: "السعة" },
  { key: "used_hours", label: "الساعات المستخدمة" },
  { key: "available_hours", label: "الساعات المتاحة" },
  { key: "utilization", label: "نسبة الاستغلال" },
  { key: "session_count", label: "عدد الجلسات" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Weekly usable hours of one room: own availability rows win over the college window. */
export function roomWeeklyAvailableHours(params: {
  roomId: string;
  availability: RoomsReportAvailability[];
  settings?: RoomsReportSettings | null;
}): number {
  const own = params.availability.filter((a) => a.room_id === params.roomId);
  if (own.length > 0) {
    return round2(
      own.reduce(
        (sum, a) => sum + (a.start_time && a.end_time ? hoursBetween(a.start_time, a.end_time) : 0),
        0,
      ),
    );
  }
  const s = params.settings;
  const days = s?.working_days?.length ?? 0;
  if (!days || !s?.day_start_time || !s?.day_end_time) return 0;
  return round2(days * hoursBetween(s.day_start_time, s.day_end_time));
}

export function buildRoomsReportSummary(params: {
  rooms: RoomsReportRoom[];
  roomTypes: RoomsReportRoomType[];
  sessions: PrintSessionLike[];
  availability: RoomsReportAvailability[];
  settings?: RoomsReportSettings | null;
}): RoomsReportSummaryRow[] {
  const typeLabel = new Map(
    params.roomTypes.map((t) => [t.id, t.name_ar ?? t.name ?? t.code ?? "—"] as const),
  );

  const used = new Map<string, { hours: number; count: number }>();
  for (const s of params.sessions) {
    if (!s.room_id) continue;
    const agg = used.get(s.room_id) ?? { hours: 0, count: 0 };
    agg.hours += hoursBetween(s.start_time, s.end_time);
    agg.count += 1;
    used.set(s.room_id, agg);
  }

  return params.rooms
    .filter((r) => r.is_active !== false)
    .map((r) => {
      const agg = used.get(r.id) ?? { hours: 0, count: 0 };
      const available = roomWeeklyAvailableHours({
        roomId: r.id,
        availability: params.availability,
        settings: params.settings,
      });
      const usedHours = round2(agg.hours);
      return {
        room_code: r.code ?? "",
        room_name: r.name ?? "",
        room_type: r.room_type_id ? (typeLabel.get(r.room_type_id) ?? "—") : "—",
        capacity: r.capacity ?? "—",
        used_hours: usedHours,
        available_hours: available,
        utilization: available > 0 ? `${Math.round((usedHours / available) * 100)}%` : "—",
        session_count: agg.count,
      };
    })
    .sort((a, b) => a.room_code.localeCompare(b.room_code, "ar"));
}

/** One print page per room that actually holds sessions in the current version. */
export function groupRoomsReportPages(
  sessions: PrintSessionLike[],
  collegeId: string,
): PrintPageGroup[] {
  return groupPrintPages(sessions, {
    reportType: "room",
    collegeId,
    studySystem: "all",
  }).sort((a, b) => (a.roomLabel ?? "").localeCompare(b.roomLabel ?? "", "ar"));
}

/** Totals for the report header (no silent drops: sessions without a room are counted). */
export function roomsReportTotals(params: {
  summary: RoomsReportSummaryRow[];
  sessions: PrintSessionLike[];
}) {
  const usedHours = round2(params.summary.reduce((s, r) => s + r.used_hours, 0));
  const availableHours = round2(params.summary.reduce((s, r) => s + r.available_hours, 0));
  return {
    rooms: params.summary.length,
    usedHours,
    availableHours,
    utilization: availableHours > 0 ? Math.round((usedHours / availableHours) * 100) : 0,
    sessions: params.sessions.length,
    sessionsWithoutRoom: params.sessions.filter((s) => !s.room_id).length,
  };
}
