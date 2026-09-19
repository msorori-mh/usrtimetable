import { compactAcademicLevelLabel } from "@/lib/reports/formatters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface StudentScheduleRow {
  id: string;
  scope_key: string;
  department: string;
  program: string;
  level: string;
  cohort: string;
  study_system: string;
  day_order: number;
  day: string;
  time: string;
  course: string;
  instructor: string;
  room: string;
  session_type: string;
  delivery_group: string;
}

/** Academic context belongs to the running table heading, not every session row. */
export function StudentScheduleTables({ rows }: { rows: StudentScheduleRow[] }) {
  const groups = new Map<string, StudentScheduleRow[]>();
  for (const row of rows) {
    const group = groups.get(row.scope_key) ?? [];
    group.push(row);
    groups.set(row.scope_key, group);
  }
  return (
    <div className="space-y-6">
      {[...groups].map(([key, group]) => {
        const context = group[0];
        const sorted = [...group].sort(
          (a, b) => a.day_order - b.day_order || a.time.localeCompare(b.time),
        );
        return (
          <section
            key={key}
            className="student-schedule-group rounded-lg border bg-card"
            aria-label={`${context.program} — ${compactAcademicLevelLabel(context.level)}`}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead colSpan={7} className="h-auto p-3 text-right">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 font-semibold">
                      <span>القسم: {context.department || "غير محدد"}</span>
                      <span>البرنامج: {context.program || "غير محدد"}</span>
                      <span>المستوى: {compactAcademicLevelLabel(context.level) || "غير محدد"}</span>
                      {context.cohort && <span>الدفعة: {context.cohort}</span>}
                      {context.study_system && <span>النظام: {context.study_system}</span>}
                    </div>
                  </TableHead>
                </TableRow>
                <TableRow>
                  <TableHead>اليوم</TableHead>
                  <TableHead>الزمن</TableHead>
                  <TableHead>المقرر</TableHead>
                  <TableHead>اسم المحاضر</TableHead>
                  <TableHead>القاعة</TableHead>
                  <TableHead>النوع</TableHead>
                  <TableHead>المجموعة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{row.day}</TableCell>
                    <TableCell className="text-center tabular-nums">
                      <bdi dir="ltr">{row.time}</bdi>
                    </TableCell>
                    <TableCell>{row.course}</TableCell>
                    <TableCell>{row.instructor}</TableCell>
                    <TableCell>{row.room}</TableCell>
                    <TableCell>{row.session_type}</TableCell>
                    <TableCell className="text-center">{row.delivery_group || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        );
      })}
    </div>
  );
}
