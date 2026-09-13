import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWeeklyGridWindow } from "@/hooks/reports/useWeeklyGridWindow";
import { TimetableGridReport } from "@/components/reports/timetable-grid-report";
import {
  TIMETABLE_TABLE_HEADERS,
  timetableSessionsToRows,
  type TimetableReportSession,
} from "@/lib/reports/session-mappers";

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
    <div className="space-y-4 report-print-body">
      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3">العرض الأسبوعي</h2>
        <TimetableGridReport
          sessions={sessions}
          workingDays={window.workingDays}
          startHour={window.startHour}
          endHour={window.endHour}
        />
      </Card>
      <Card className="p-0 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((h) => (
                <TableHead key={h.key}>{h.label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                {headers.map((h) => (
                  <TableCell key={h.key}>{String(r[h.key] ?? "")}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
