import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  courseTitle,
  sessionTypeLabel,
  studySystemLabel,
  type TimetableReportSession,
} from "@/lib/reports/session-mappers";

const DAY_LABELS: Record<number, string> = {
  6: "السبت",
  0: "الأحد",
  1: "الاثنين",
  2: "الثلاثاء",
  3: "الأربعاء",
  4: "الخميس",
  5: "الجمعة",
};

const t = (s: string) => (s.length === 5 ? `${s}:00` : s);
const toMins = (s: string) => {
  const [h, m] = t(s).split(":").map(Number);
  return h * 60 + m;
};

const colorByType = (type: string) => {
  switch (type) {
    case "lab":
      return "bg-emerald-500/20 border-emerald-500/50";
    case "tutorial":
      return "bg-amber-500/20 border-amber-500/50";
    case "seminar":
      return "bg-violet-500/20 border-violet-500/50";
    case "workshop":
      return "bg-cyan-500/20 border-cyan-500/50";
    case "lecture":
    default:
      return "bg-primary/20 border-primary/50";
  }
};

interface PlacedSession {
  session: TimetableReportSession;
  lane: number;
  laneCount: number;
}

function assignLanes(daySessions: TimetableReportSession[]): PlacedSession[] {
  const sorted = [...daySessions].sort(
    (a, b) => toMins(a.start_time) - toMins(b.start_time) || toMins(a.end_time) - toMins(b.end_time),
  );
  const lanes: TimetableReportSession[][] = [];

  for (const sess of sorted) {
    const start = toMins(sess.start_time);
    const end = toMins(sess.end_time);
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      const last = lanes[i][lanes[i].length - 1];
      if (toMins(last.end_time) <= start) {
        lanes[i].push(sess);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([sess]);
  }

  const laneOf = new Map<string, number>();
  lanes.forEach((lane, idx) => lane.forEach((s) => laneOf.set(s.id, idx)));

  // Expand lane count for overlapping groups.
  const placed: PlacedSession[] = sorted.map((session) => {
    const start = toMins(session.start_time);
    const end = toMins(session.end_time);
    const overlapping = sorted.filter(
      (o) => toMins(o.start_time) < end && toMins(o.end_time) > start,
    );
    const usedLanes = new Set(overlapping.map((o) => laneOf.get(o.id) ?? 0));
    return {
      session,
      lane: laneOf.get(session.id) ?? 0,
      laneCount: Math.max(usedLanes.size, 1),
    };
  });

  return placed;
}

export interface TimetableGridReportProps {
  sessions: TimetableReportSession[];
  workingDays?: number[];
  startHour?: number;
  endHour?: number;
}

export function TimetableGridReport({
  sessions,
  workingDays: workingDaysProp,
  startHour: startHourProp,
  endHour: endHourProp,
}: TimetableGridReportProps) {
  const workingDays = useMemo(() => {
    if (workingDaysProp?.length) return workingDaysProp;
    const days = [...new Set(sessions.map((s) => s.day_of_week))].sort((a, b) => a - b);
    return days.length ? days : [6, 0, 1, 2, 3, 4];
  }, [sessions, workingDaysProp]);

  const { startHour, endHour } = useMemo(() => {
    if (startHourProp != null && endHourProp != null) {
      return { startHour: startHourProp, endHour: endHourProp };
    }
    if (!sessions.length) return { startHour: 8, endHour: 18 };
    let minM = Infinity;
    let maxM = -Infinity;
    for (const s of sessions) {
      minM = Math.min(minM, toMins(s.start_time));
      maxM = Math.max(maxM, toMins(s.end_time));
    }
    return {
      startHour: startHourProp ?? Math.max(7, Math.floor(minM / 60) - 1),
      endHour: endHourProp ?? Math.min(22, Math.ceil(maxM / 60) + 1),
    };
  }, [sessions, startHourProp, endHourProp]);

  const slots = useMemo(() => {
    const arr: { label: string; mins: number }[] = [];
    for (let h = startHour; h <= endHour; h++) {
      arr.push({ label: `${String(h).padStart(2, "0")}:00`, mins: h * 60 });
    }
    return arr;
  }, [startHour, endHour]);

  const SLOT_PX = 56;
  const totalHeight = (endHour - startHour) * SLOT_PX + SLOT_PX;

  const placedByDay = useMemo(() => {
    const map = new Map<number, PlacedSession[]>();
    for (const d of workingDays) {
      map.set(d, assignLanes(sessions.filter((s) => s.day_of_week === d)));
    }
    return map;
  }, [sessions, workingDays]);

  if (!sessions.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">لا توجد محاضرات لعرضها في الشبكة.</p>
    );
  }

  return (
    <div className="report-timetable-grid overflow-auto border rounded-md" dir="rtl">
      <div
        className="grid min-w-[640px]"
        style={{ gridTemplateColumns: `80px repeat(${workingDays.length}, minmax(160px, 1fr))` }}
      >
        <div className="bg-muted/40 border-b border-l p-2 text-xs font-medium sticky top-0 z-10">
          الوقت
        </div>
        {workingDays.map((d) => (
          <div
            key={d}
            className="bg-muted/40 border-b border-l p-2 text-xs font-medium text-center sticky top-0 z-10"
          >
            {DAY_LABELS[d] ?? DAY_LABELS[0]}
          </div>
        ))}

        <div className="border-l" style={{ height: totalHeight }}>
          {slots.map((s) => (
            <div
              key={s.mins}
              className="text-[10px] text-muted-foreground p-1 border-b"
              style={{ height: SLOT_PX }}
            >
              {s.label}
            </div>
          ))}
        </div>

        {workingDays.map((d) => {
          const placed = placedByDay.get(d) ?? [];
          return (
            <div key={d} className="relative border-l" style={{ height: totalHeight }}>
              {slots.map((s) => (
                <div
                  key={s.mins}
                  className="border-b bg-background/50"
                  style={{ height: SLOT_PX }}
                />
              ))}
              {placed.map(({ session: sess, lane, laneCount }) => {
                const top = ((toMins(sess.start_time) - startHour * 60) / 60) * SLOT_PX;
                const height = ((toMins(sess.end_time) - toMins(sess.start_time)) / 60) * SLOT_PX;
                if (top < 0 || height <= 0) return null;
                const widthPct = 100 / laneCount;
                const rightPct = lane * widthPct;
                return (
                  <div
                    key={sess.id}
                    className={cn(
                      "absolute rounded border text-right p-1.5 text-xs overflow-hidden",
                      colorByType(sess.session_type),
                    )}
                    style={{
                      top: top + 1,
                      height: height - 2,
                      width: `calc(${widthPct}% - 4px)`,
                      right: `calc(${rightPct}% + 2px)`,
                    }}
                    title={courseTitle(sess)}
                  >
                    <div className="font-semibold truncate text-[11px]">{courseTitle(sess)}</div>
                    <div className="text-[10px] truncate text-muted-foreground">
                      {sessionTypeLabel(sess.session_type)}
                      {sess.instructor_name ? ` · ${sess.instructor_name}` : ""}
                    </div>
                    <div className="text-[10px] truncate text-muted-foreground">
                      {sess.room_label || "—"}
                      {sess.section_number ? ` · ش${sess.section_number}` : ""}
                    </div>
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      <span className="text-[9px] bg-background/70 rounded px-1">
                        {sess.start_time.slice(0, 5)}–{sess.end_time.slice(0, 5)}
                      </span>
                      <span className="text-[9px] bg-background/70 rounded px-1">
                        {studySystemLabel(sess.study_system)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
