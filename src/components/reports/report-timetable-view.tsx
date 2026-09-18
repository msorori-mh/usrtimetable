import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { useWeeklyGridWindow } from "@/hooks/reports/useWeeklyGridWindow";
import { TimetableGridReport } from "@/components/reports/timetable-grid-report";
import { DAY_NAMES_AR } from "@/lib/reports/formatters";
import { orderWeekDaysRtl, rtlDayRank } from "@/lib/reports/weekly-grid-window";
import {
  TIMETABLE_TABLE_HEADERS,
  timetableSessionsToRows,
  sessionTypeLabel,
  type TimetableReportSession,
} from "@/lib/reports/session-mappers";

const SECONDARY_KEYS = new Set([
  "department",
  "program",
  "level",
  "study_system",
  "section",
  "cohort",
]);
interface Props {
  sessions: TimetableReportSession[];
  collegeId?: string | null;
  headers?: { key: string; label: string }[];
  hideInstructor?: boolean;
}

export function ReportTimetableView({
  sessions,
  collegeId,
  headers = TIMETABLE_TABLE_HEADERS,
  hideInstructor = false,
}: Props) {
  const [mode, setMode] = useState<"week" | "day" | "list">("week");
  useEffect(() => {
    const media = globalThis.window.matchMedia("(max-width: 767px)");
    const adapt = () => {
      if (media.matches) setMode((value) => (value === "week" ? "day" : value));
    };
    adapt();
    media.addEventListener("change", adapt);
    return () => media.removeEventListener("change", adapt);
  }, []);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [fullWindow, setFullWindow] = useState(false);
  const { window } = useWeeklyGridWindow(collegeId);
  const ordered = [...sessions].sort(
    (a, b) =>
      rtlDayRank(a.day_of_week) - rtlDayRank(b.day_of_week) ||
      a.start_time.localeCompare(b.start_time),
  );
  const rows = timetableSessionsToRows(ordered);
  const days = orderWeekDaysRtl([...window.workingDays, ...sessions.map((s) => s.day_of_week)]);
  const day =
    selectedDay !== null && days.includes(selectedDay)
      ? selectedDay
      : (ordered[0]?.day_of_week ?? days[0]);
  const hour = (time: string) => Number(time.slice(0, 2)) + Number(time.slice(3, 5)) / 60;
  const occupiedStart = sessions.length
    ? Math.floor(Math.min(...sessions.map((s) => hour(s.start_time))))
    : window.startHour;
  const occupiedEnd = sessions.length
    ? Math.ceil(Math.max(...sessions.map((s) => hour(s.end_time))))
    : window.endHour;
  const gridProps = {
    sessions,
    workingDays: days,
    hideInstructor,
    startHour: fullWindow ? Math.min(window.startHour, occupiedStart) : occupiedStart,
    endHour: fullWindow ? Math.max(window.endHour, occupiedEnd) : occupiedEnd,
  };
  return (
    <div className="report-print-body min-w-0 space-y-4">
      <div className="report-no-print flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex gap-1 rounded-lg bg-muted p-1"
          role="group"
          aria-label="طريقة عرض الجدول"
        >
          {(
            [
              ["week", "أسبوعي"],
              ["day", "يومي"],
              ["list", "قائمة"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? "default" : "ghost"}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {label}
            </Button>
          ))}
        </div>
        {mode === "week" && (
          <Button
            variant="outline"
            size="sm"
            aria-pressed={fullWindow}
            onClick={() => setFullWindow(!fullWindow)}
          >
            {fullWindow ? "عرض ساعات المحاضرات" : "عرض كامل الدوام"}
          </Button>
        )}
      </div>
      <div className={mode === "week" ? "report-no-print" : "hidden"}>
        <ReportSection
          title="العرض الأسبوعي"
          hint="اختر المحاضرة لقراءة جميع تفاصيلها. الألوان تميز نوع المحاضرة."
        >
          <TimetableGridReport {...gridProps} />
        </ReportSection>
      </div>
      <div className={mode === "day" ? "report-no-print" : "hidden"}>
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="أيام الجدول">
          {days.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={day === d ? "default" : "outline"}
              aria-pressed={day === d}
              onClick={() => setSelectedDay(d)}
            >
              {DAY_NAMES_AR[d]}
            </Button>
          ))}
        </div>
        <div className="space-y-3">
          {ordered
            .filter((s) => s.day_of_week === day)
            .map((s) => (
              <article key={s.id} className="rounded-xl border bg-card p-4">
                <p className="font-semibold text-primary" dir="ltr">
                  {s.start_time.slice(0, 5)} – {s.end_time.slice(0, 5)}
                </p>
                <h3 className="mt-2 text-base font-bold">{s.course_name}</h3>
                <p className="mt-1 text-sm">
                  {s.room_label || "القاعة غير محددة"} · {sessionTypeLabel(s.session_type)}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {[s.program_name, s.level_name, s.cohort_label, s.delivery_group_label]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {!hideInstructor && s.instructor_name && (
                  <p className="mt-1 text-sm">{s.instructor_name}</p>
                )}
              </article>
            ))}
          {!ordered.some((s) => s.day_of_week === day) && (
            <p className="rounded-lg border p-6 text-center text-muted-foreground">
              لا توجد محاضرات في هذا اليوم.
            </p>
          )}
        </div>
      </div>
      <div className={mode === "list" ? "report-no-print" : "hidden"}>
        <ReportSection title="تفصيل المحاضرات" count={rows.length}>
          <ReportDataTable
            caption="تفصيل محاضرات الجدول"
            columns={headers.map((h) => ({
              ...h,
              numeric: ["hours", "time", "start_time", "end_time"].includes(h.key),
              secondary: SECONDARY_KEYS.has(h.key),
            }))}
            rows={rows}
          />
        </ReportSection>
      </div>
      <div className="hidden print:block">
        <TimetableGridReport {...gridProps} />
        <div className="report-print-details mt-4">
          <h2 className="mb-3 text-base font-bold">تفصيل المحاضرات</h2>
          <ReportDataTable
            caption="تفصيل محاضرات الجدول"
            columns={headers.map((h) => ({
              ...h,
              numeric: ["hours", "time", "start_time", "end_time"].includes(h.key),
            }))}
            rows={rows}
          />
        </div>
      </div>
    </div>
  );
}
