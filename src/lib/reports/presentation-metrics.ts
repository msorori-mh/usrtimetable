/** Pure report calculations. Intervals are minutes on the same teaching day. */
export type Interval = [number, number];
export function minutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 24 || m < 0 || m >= 60)
    throw new Error("وقت غير صالح في التقرير");
  return h * 60 + m;
}
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [start, end] of [...intervals].sort((a, b) => a[0] - b[0])) {
    if (end <= start) throw new Error("مدة غير صالحة في التقرير");
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}
const duration = (intervals: Interval[]) => intervals.reduce((sum, [s, e]) => sum + e - s, 0);
const round = (n: number) => Math.round(n * 100) / 100;
export interface ReportTime {
  day_of_week: number;
  start_time: string;
  end_time: string;
}
export interface ReportRoomClosure {
  room_id: string;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  start_date: string | null;
  end_date: string | null;
}

function subtractIntervals(windows: Interval[], closed: Interval[]): Interval[] {
  return mergeIntervals(closed).reduce(
    (remaining, [a, b]) =>
      remaining.flatMap(([s, e]): Interval[] => {
        if (b <= s || a >= e) return [[s, e]];
        return [...(s < a ? [[s, a] as Interval] : []), ...(b < e ? [[b, e] as Interval] : [])];
      }),
    windows,
  );
}
export function attendanceMetrics(sessions: ReportTime[]) {
  let gapMinutes = 0,
    occupiedMinutes = 0,
    spanMinutes = 0;
  const days = [...new Set(sessions.map((s) => s.day_of_week))];
  for (const day of days) {
    const merged = mergeIntervals(
      sessions
        .filter((s) => s.day_of_week === day)
        .map((s) => [minutes(s.start_time), minutes(s.end_time)]),
    );
    const occupied = duration(merged);
    const span = merged.length ? merged[merged.length - 1][1] - merged[0][0] : 0;
    occupiedMinutes += occupied;
    spanMinutes += span;
    gapMinutes += span - occupied;
  }
  return {
    days: days.length,
    gapHours: round(gapMinutes / 60),
    occupiedHours: round(occupiedMinutes / 60),
    presenceHours: round(spanMinutes / 60),
  };
}
export function roomUtilizationMetrics(input: {
  settings: {
    working_days: number[] | null;
    day_start_time: string | null;
    day_end_time: string | null;
  } | null;
  room: {
    available_days?: number[] | null;
    available_start_time?: string | null;
    available_end_time?: string | null;
  };
  availability: ReportTime[];
  unavailability?: ReportRoomClosure[];
  sessions: ReportTime[];
}) {
  const settings = input.settings;
  if (input.unavailability?.some((row) => row.start_date || row.end_date))
    throw new Error("توجد فترات منع مرتبطة بتواريخ؛ لا يمكن اختزال الإتاحة في أسبوع ثابت");
  if (!settings?.working_days?.length || !settings.day_start_time || !settings.day_end_time)
    throw new Error("أكمل أيام وساعات الدوام لحساب استخدام القاعات");
  const start = minutes(settings.day_start_time),
    end = minutes(settings.day_end_time);
  if (end <= start) throw new Error("ساعات الدوام غير صالحة");
  let available = 0,
    used = 0,
    scheduled = 0,
    occupied = 0,
    blocked = 0,
    rawInside = 0;
  const days = [
    ...new Set([...settings.working_days, ...input.sessions.map((s) => s.day_of_week)]),
  ];
  for (const day of days) {
    const windows: Interval[] = !settings.working_days.includes(day)
      ? []
      : input.availability.length
        ? input.availability
            .filter((a) => a.day_of_week === day)
            .map((a) => [
              Math.max(start, minutes(a.start_time)),
              Math.min(end, minutes(a.end_time)),
            ])
        : input.room.available_days && !input.room.available_days.includes(day)
          ? []
          : [
              [
                Math.max(
                  start,
                  input.room.available_start_time
                    ? minutes(input.room.available_start_time)
                    : start,
                ),
                Math.min(
                  end,
                  input.room.available_end_time ? minutes(input.room.available_end_time) : end,
                ),
              ],
            ];
    const base = mergeIntervals(windows.filter(([s, e]) => e > s));
    const closures: Interval[] = (input.unavailability ?? [])
      .filter((row) => row.day_of_week === null || row.day_of_week === day)
      .map((row) => [
        row.start_time ? minutes(row.start_time) : 0,
        row.end_time ? minutes(row.end_time) : 1440,
      ]);
    const free = subtractIntervals(base, closures);
    blocked += duration(base) - duration(free);
    const raw: Interval[] = input.sessions
      .filter((s) => s.day_of_week === day)
      .map((s) => [minutes(s.start_time), minutes(s.end_time)]);
    const busy = mergeIntervals(raw);
    available += duration(free);
    occupied += duration(busy);
    scheduled += duration(raw);
    for (const [s, e] of raw)
      for (const [a, b] of free) rawInside += Math.max(0, Math.min(e, b) - Math.max(s, a));
    for (const [s, e] of busy)
      for (const [a, b] of free) used += Math.max(0, Math.min(e, b) - Math.max(s, a));
  }
  return {
    available_hours: round(available / 60),
    scheduled_hours: round(scheduled / 60),
    occupied_hours: round(used / 60),
    idle_hours: round((available - used) / 60),
    idle_pct: available > 0 ? round(((available - used) / available) * 100) : null,
    utilization_pct: available > 0 ? round((used / available) * 100) : null,
    outside_hours: round((occupied - used) / 60),
    overlap_hours: round((scheduled - occupied) / 60),
    inside_overlap_hours: round((rawInside - used) / 60),
    blocked_hours: round(blocked / 60),
  };
}
