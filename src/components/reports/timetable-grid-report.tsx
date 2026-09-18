import { useMemo, useState, type CSSProperties } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  orderWeekDaysRtl,
  RTL_WEEK_DAY_ORDER,
  WEEK_DAY_LABELS_AR,
  weeklyGridHourSlots,
  WEEKLY_GRID_FALLBACK,
} from "@/lib/reports/weekly-grid-window";
import {
  courseTitle,
  sessionTypeLabel,
  studySystemLabel,
  type TimetableReportSession,
} from "@/lib/reports/session-mappers";

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
    (a, b) =>
      toMins(a.start_time) - toMins(b.start_time) || toMins(a.end_time) - toMins(b.end_time),
  );
  const output: PlacedSession[] = [];
  let cluster: PlacedSession[] = [];
  let ends: number[] = [];
  let clusterEnd = -1;
  const flush = () => {
    output.push(...cluster.map((entry) => ({ ...entry, laneCount: ends.length })));
    cluster = [];
    ends = [];
    clusterEnd = -1;
  };
  for (const session of sorted) {
    const start = toMins(session.start_time),
      end = toMins(session.end_time);
    if (start >= clusterEnd && cluster.length) flush();
    let lane = ends.findIndex((e) => e <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = end;
    cluster.push({ session, lane, laneCount: 1 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return output;
}

export interface TimetableGridReportProps {
  sessions: TimetableReportSession[];
  workingDays?: number[];
  startHour?: number;
  endHour?: number;
  hideInstructor?: boolean;
}

export function TimetableGridReport({
  sessions,
  workingDays: workingDaysProp,
  startHour: startHourProp,
  endHour: endHourProp,
  hideInstructor = false,
}: TimetableGridReportProps) {
  const [selected, setSelected] = useState<TimetableReportSession | null>(null);
  const workingDays = useMemo(() => {
    // Configured working days win; otherwise fall back to the standard RTL week.
    if (workingDaysProp?.length) return orderWeekDaysRtl(workingDaysProp);
    return [...RTL_WEEK_DAY_ORDER];
  }, [workingDaysProp]);

  const { startHour, endHour } = useMemo(
    () => ({
      startHour: startHourProp ?? WEEKLY_GRID_FALLBACK.startHour,
      endHour: endHourProp ?? WEEKLY_GRID_FALLBACK.endHour,
    }),
    [startHourProp, endHourProp],
  );

  const slots = useMemo(() => weeklyGridHourSlots({ startHour, endHour }), [startHour, endHour]);

  const SLOT_PX = 56;
  const totalHeight = Math.max(endHour - startHour, 1) * SLOT_PX;

  const placedByDay = useMemo(() => {
    const map = new Map<number, PlacedSession[]>();
    for (const d of workingDays) {
      map.set(d, assignLanes(sessions.filter((s) => s.day_of_week === d)));
    }
    return map;
  }, [sessions, workingDays]);

  if (!sessions.length) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">
        لا توجد محاضرات لعرضها في الشبكة.
      </p>
    );
  }

  return (
    <>
      <div className="report-timetable-grid overflow-auto border rounded-md" dir="rtl">
        <div
          className="grid min-w-[640px]"
          style={
            {
              "--report-days": workingDays.length,
              gridTemplateColumns: `80px repeat(${workingDays.length}, minmax(160px, 1fr))`,
            } as CSSProperties
          }
        >
          <div className="bg-muted/40 border-b border-l p-2 text-xs font-medium sticky top-0 z-10">
            الوقت
          </div>
          {workingDays.map((d) => (
            <div
              key={d}
              className="bg-muted/40 border-b border-l p-2 text-xs font-medium text-center sticky top-0 z-10"
            >
              {WEEK_DAY_LABELS_AR[d] ?? String(d)}
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
                    <button
                      type="button"
                      onClick={() => setSelected(sess)}
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
                      aria-label={`${courseTitle(sess)}، ${sess.start_time.slice(0, 5)}، ${sess.room_label}`}
                      title={courseTitle(sess)}
                    >
                      <div className="line-clamp-2 text-[13px] font-bold leading-tight">
                        {sess.course_name}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        <span className="rounded bg-background/70 px-1 text-[10px] font-medium">
                          {sessionTypeLabel(sess.session_type)}
                        </span>
                        <bdi
                          dir="ltr"
                          className="whitespace-nowrap rounded bg-background/70 px-1 text-[10px] font-semibold tabular-nums"
                        >
                          {sess.start_time.slice(0, 5)}–{sess.end_time.slice(0, 5)}
                        </bdi>
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-foreground/80">
                        {sess.room_label || "—"}
                        {sess.section_number ? ` · ش${sess.section_number}` : ""}
                        {sess.delivery_group_label ? (
                          <>
                            {" · "}
                            <bdi dir="ltr" className="whitespace-nowrap">
                              {sess.delivery_group_label}
                            </bdi>
                          </>
                        ) : (
                          ""
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {!hideInstructor && sess.instructor_name && (
                          <span className="line-clamp-1 text-[10px] text-foreground/80">
                            {sess.instructor_name}
                          </span>
                        )}
                        <span className="rounded bg-background/70 px-1 text-[10px]">
                          {studySystemLabel(sess.study_system)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{selected?.course_name}</DialogTitle>
            <DialogDescription>تفاصيل المحاضرة في النسخة المختارة</DialogDescription>
          </DialogHeader>
          {selected && (
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {Object.entries({
                اليوم: WEEK_DAY_LABELS_AR[selected.day_of_week],
                الوقت: `${selected.start_time.slice(0, 5)} – ${selected.end_time.slice(0, 5)}`,
                القاعة: selected.room_label,
                المحاضر: selected.instructor_name,
                البرنامج: selected.program_name,
                المستوى: selected.level_name,
                الدفعة: selected.cohort_label,
                المجموعة: selected.delivery_group_label || selected.section_number,
                النوع: sessionTypeLabel(selected.session_type),
                النظام: studySystemLabel(selected.study_system),
              }).map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-medium">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
