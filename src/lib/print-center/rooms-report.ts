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
import { entityDisplayName } from "@/lib/entity-display";

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
  name_en?: string | null;
  name?: string | null;
  code?: string | null;
}

export interface RoomsReportAvailability {
  room_id: string;
  day_of_week?: number | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface RoomsReportSettings {
  working_days?: number[] | null;
  day_start_time?: string | null;
  day_end_time?: string | null;
}

export interface RoomsReportSummaryRow {
  room_id: string;
  room_code: string;
  room_name: string;
  room_type: string;
  room_category: "hall" | "lab";
  capacity: number | string;
  used_hours: number;
  available_hours: number;
  free_hours: number;
  overbooked_hours: number;
  utilization_percent: number;
  utilization: string;
  session_count: number;
  average_students: number;
  capacity_efficiency_percent: number;
  max_students: number;
  max_capacity_efficiency_percent: number;
  peak_day: string;
  peak_slot: string;
  theory_sessions: number;
  applied_sessions: number;
}

export const ROOMS_REPORT_SUMMARY_HEADERS: { key: keyof RoomsReportSummaryRow; label: string }[] = [
  { key: "room_code", label: "الرمز" },
  { key: "room_name", label: "القاعة" },
  { key: "room_type", label: "النوع" },
  { key: "capacity", label: "السعة" },
  { key: "used_hours", label: "الساعات المستخدمة" },
  { key: "available_hours", label: "الساعات المتاحة" },
  { key: "free_hours", label: "الساعات الفارغة" },
  { key: "utilization", label: "استغلال الوقت" },
  { key: "session_count", label: "عدد الجلسات" },
  { key: "average_students", label: "متوسط الطلاب" },
  { key: "capacity_efficiency_percent", label: "كفاءة استغلال السعة %" },
  { key: "max_students", label: "أعلى عدد طلاب" },
  { key: "peak_day", label: "أكثر يوم استخدامًا" },
  { key: "peak_slot", label: "فترة الذروة" },
  { key: "theory_sessions", label: "الجلسات النظرية" },
  { key: "applied_sessions", label: "الجلسات العملية/الأخرى" },
];

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY_NAMES_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

function mostFrequent<T>(values: T[]): T | null {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function isTheorySession(type: string | null | undefined): boolean {
  return type === "lecture" || type === "theory";
}

export function roomCategoryFromType(code: string | null | undefined): "hall" | "lab" {
  const normalized = (code ?? "").toLocaleLowerCase();
  return normalized.includes("lab") || normalized === "workshop" ? "lab" : "hall";
}

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
    params.roomTypes.map((t) => [t.id, t.name_ar ?? t.name ?? t.name_en ?? t.code ?? "—"] as const),
  );
  const typeCode = new Map(params.roomTypes.map((t) => [t.id, t.code ?? ""] as const));

  const used = new Map<string, { hours: number; sessions: PrintSessionLike[] }>();
  for (const s of params.sessions) {
    if (!s.room_id) continue;
    const agg = used.get(s.room_id) ?? { hours: 0, sessions: [] };
    agg.hours += hoursBetween(s.start_time, s.end_time);
    agg.sessions.push(s);
    used.set(s.room_id, agg);
  }

  return params.rooms
    .filter((r) => r.is_active !== false)
    .map((r) => {
      const agg = used.get(r.id) ?? { hours: 0, sessions: [] };
      const available = roomWeeklyAvailableHours({
        roomId: r.id,
        availability: params.availability,
        settings: params.settings,
      });
      const usedHours = round2(agg.hours);
      const freeHours = round2(Math.max(0, available - usedHours));
      const overbookedHours = round2(Math.max(0, usedHours - available));
      const utilization = available > 0 ? Math.round((usedHours / available) * 100) : 0;
      const students = agg.sessions
        .map((s) => Number(s.expected_students))
        .filter((n) => Number.isFinite(n) && n >= 0);
      const averageStudents = students.length
        ? round2(students.reduce((sum, n) => sum + n, 0) / students.length)
        : 0;
      const numericCapacity = typeof r.capacity === "number" && r.capacity > 0 ? r.capacity : 0;
      const peakDay = mostFrequent(agg.sessions.map((s) => s.day_of_week));
      const peakSlot = mostFrequent(
        agg.sessions.map((s) => `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`),
      );
      return {
        room_id: r.id,
        room_code: r.code ?? "",
        room_name: entityDisplayName(r, "قاعة غير مسماة"),
        room_type: r.room_type_id ? (typeLabel.get(r.room_type_id) ?? "—") : "—",
        room_category: roomCategoryFromType(
          r.room_type_id ? (typeCode.get(r.room_type_id) ?? "") : "",
        ),
        capacity: r.capacity ?? "—",
        used_hours: usedHours,
        available_hours: available,
        free_hours: freeHours,
        overbooked_hours: overbookedHours,
        utilization_percent: utilization,
        utilization: available > 0 ? `${utilization}%` : "—",
        session_count: agg.sessions.length,
        average_students: averageStudents,
        capacity_efficiency_percent: numericCapacity
          ? Math.round((averageStudents / numericCapacity) * 100)
          : 0,
        max_students: students.length ? Math.max(...students) : 0,
        max_capacity_efficiency_percent: numericCapacity
          ? Math.round((Math.max(0, ...students) / numericCapacity) * 100)
          : 0,
        peak_day: peakDay == null ? "—" : (DAY_NAMES_AR[peakDay] ?? "—"),
        peak_slot: peakSlot ?? "—",
        theory_sessions: agg.sessions.filter((s) => isTheorySession(s.session_type)).length,
        applied_sessions: agg.sessions.filter((s) => !isTheorySession(s.session_type)).length,
      };
    })
    .sort((a, b) => a.room_name.localeCompare(b.room_name, "ar"));
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
  const freeHours = round2(params.summary.reduce((s, r) => s + r.free_hours, 0));
  const overbookedHours = round2(params.summary.reduce((s, r) => s + r.overbooked_hours, 0));
  return {
    rooms: params.summary.length,
    usedHours,
    availableHours,
    freeHours,
    overbookedHours,
    utilization: availableHours > 0 ? Math.round((usedHours / availableHours) * 100) : 0,
    sessions: params.sessions.length,
    sessionsWithoutRoom: params.sessions.filter((s) => !s.room_id).length,
  };
}

export type RoomsUtilizationBand = "crowded" | "medium" | "low";

export interface RoomsHeatmapCell {
  day: number;
  dayLabel: string;
  slot: string;
  occupiedRooms: number;
  availableRooms: number;
  utilizationPercent: number;
}

export interface RoomsReportAnalytics {
  halls: number;
  labs: number;
  hallAverageUtilization: number;
  labAverageUtilization: number;
  bands: Record<RoomsUtilizationBand, number>;
  topFive: RoomsReportSummaryRow[];
  bottomFive: RoomsReportSummaryRow[];
  highest: RoomsReportSummaryRow | null;
  lowest: RoomsReportSummaryRow | null;
  highTimeLowCapacity: RoomsReportSummaryRow[];
  heatmap: RoomsHeatmapCell[];
  comparison: Array<{
    category: string;
    averageUtilization: number;
    usedHours: number;
    freeHours: number;
  }>;
  insight: string;
}

function average(values: number[]): number {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function availabilityContains(
  row: RoomsReportAvailability,
  day: number,
  start: string,
  end: string,
): boolean {
  return (
    (row.day_of_week == null || row.day_of_week === day) &&
    !!row.start_time &&
    !!row.end_time &&
    row.start_time <= start &&
    row.end_time >= end
  );
}

export function buildRoomsHeatmap(params: {
  summary: RoomsReportSummaryRow[];
  sessions: PrintSessionLike[];
  availability: RoomsReportAvailability[];
  settings?: RoomsReportSettings | null;
}): RoomsHeatmapCell[] {
  const roomIds = new Set(params.summary.map((row) => row.room_id));
  const slots = [
    ...new Set(
      params.sessions.map((s) => `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`),
    ),
  ].sort();
  const workingDays = params.settings?.working_days ?? [0, 1, 2, 3, 4, 6];
  const ownByRoom = new Map<string, RoomsReportAvailability[]>();
  for (const row of params.availability) {
    const list = ownByRoom.get(row.room_id) ?? [];
    list.push(row);
    ownByRoom.set(row.room_id, list);
  }
  return workingDays.flatMap((day) =>
    slots.map((slot) => {
      const [start, end] = slot.split("–");
      const occupiedRooms = new Set(
        params.sessions
          .filter(
            (s) =>
              s.room_id &&
              roomIds.has(s.room_id) &&
              s.day_of_week === day &&
              `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}` === slot,
          )
          .map((s) => s.room_id),
      ).size;
      const availableRooms = params.summary.filter((room) => {
        const own = ownByRoom.get(room.room_id) ?? [];
        if (own.length > 0) return own.some((row) => availabilityContains(row, day, start, end));
        return (
          workingDays.includes(day) &&
          !!params.settings?.day_start_time &&
          !!params.settings?.day_end_time &&
          params.settings.day_start_time <= start &&
          params.settings.day_end_time >= end
        );
      }).length;
      return {
        day,
        dayLabel: DAY_NAMES_AR[day] ?? String(day),
        slot,
        occupiedRooms,
        availableRooms,
        utilizationPercent:
          availableRooms > 0 ? Math.round((occupiedRooms / availableRooms) * 100) : 0,
      };
    }),
  );
}

export function utilizationBand(percent: number): RoomsUtilizationBand {
  if (percent >= 90) return "crowded";
  if (percent >= 80) return "medium";
  return "low";
}

export function buildRoomsReportAnalytics(params: {
  summary: RoomsReportSummaryRow[];
  sessions: PrintSessionLike[];
  availability: RoomsReportAvailability[];
  settings?: RoomsReportSettings | null;
}): RoomsReportAnalytics {
  const ranked = [...params.summary].sort(
    (a, b) => b.utilization_percent - a.utilization_percent || b.used_hours - a.used_hours,
  );
  const halls = params.summary.filter((row) => row.room_category === "hall");
  const labs = params.summary.filter((row) => row.room_category === "lab");
  const categorySummary = (rows: RoomsReportSummaryRow[], category: string) => ({
    category,
    averageUtilization: average(rows.map((row) => row.utilization_percent)),
    usedHours: round2(rows.reduce((sum, row) => sum + row.used_hours, 0)),
    freeHours: round2(rows.reduce((sum, row) => sum + row.free_hours, 0)),
  });
  const highest = ranked[0] ?? null;
  const lowest = ranked.at(-1) ?? null;
  const insight = highest && lowest
    ? `الضغط الأعلى على ${highest.room_name} باستغلال زمني ${highest.utilization}، بينما توجد سعة زمنية إضافية في ${lowest.room_name} (${lowest.free_hours} ساعة فارغة).`
    : "لا توجد بيانات كافية لصياغة الاستنتاج التنفيذي.";
  return {
    halls: halls.length,
    labs: labs.length,
    hallAverageUtilization: average(halls.map((row) => row.utilization_percent)),
    labAverageUtilization: average(labs.map((row) => row.utilization_percent)),
    bands: {
      crowded: params.summary.filter((row) => utilizationBand(row.utilization_percent) === "crowded")
        .length,
      medium: params.summary.filter((row) => utilizationBand(row.utilization_percent) === "medium")
        .length,
      low: params.summary.filter((row) => utilizationBand(row.utilization_percent) === "low").length,
    },
    topFive: ranked.slice(0, 5),
    bottomFive: [...ranked].reverse().slice(0, 5),
    highest,
    lowest,
    highTimeLowCapacity: ranked.filter(
      (row) => row.utilization_percent >= 80 && row.capacity_efficiency_percent < 60,
    ),
    heatmap: buildRoomsHeatmap(params),
    comparison: [categorySummary(halls, "القاعات النظرية"), categorySummary(labs, "المعامل")],
    insight,
  };
}
