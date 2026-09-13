import { ReportSection, ReportDataTable } from "@/components/reports/report-section";
import { useWeeklyGridWindow } from "@/hooks/reports/useWeeklyGridWindow";
import { TimetableGridReport } from "@/components/reports/timetable-grid-report";
import {
  TIMETABLE_TABLE_HEADERS,
  timetableSessionsToRows,
  type TimetableReportSession,
} from "@/lib/reports/session-mappers";

/** Columns that stay hidden on phones; the grid above already shows the essentials. */
const SECONDARY_KEYS = new Set(["department", "program", "level", "study_system"]);
const NUMERIC_KEYS = new Set(["hours"]);

interface Props {
  sessions: TimetableReportSession[];
  /** College whose scheduling settings define the grid days and hour window. */
  collegeId?: string | null;
  /** Override default export/table headers (e.g. hide department column). */
  headers?: { key: string; label: string }[];
}

export function ReportTimetableView({
  sessions,
  collegeId,
  headers = TIMETABLE_TABLE_HEADERS,
}: Props) {
  const rows = timetableSessionsToRows(sessions);
  const { window } = useWeeklyGridWindow(collegeId);

  return (
    <div className="report-print-body min-w-0 space-y-4">
      <ReportSection
        title="العرض الأسبوعي"
        hint="السبت إلى الخميس وفق أيام العمل وساعات الدوام المعتمدة للكلية."
        bodyClassName="p-4"
      >
        <TimetableGridReport
          sessions={sessions}
          workingDays={window.workingDays}
          startHour={window.startHour}
          endHour={window.endHour}
        />
      </ReportSection>

      <ReportSection
        title="تفصيل المحاضرات"
        count={rows.length}
        hint="كل محاضرة في سطر — الأعمدة الثانوية تظهر على الشاشات الأوسع وفي الطباعة."
      >
        <ReportDataTable
          caption="تفصيل محاضرات الجدول"
          columns={headers.map((h) => ({
            key: h.key,
            label: h.label,
            numeric: NUMERIC_KEYS.has(h.key),
            secondary: SECONDARY_KEYS.has(h.key),
          }))}
          rows={rows}
        />
      </ReportSection>
    </div>
  );
}
