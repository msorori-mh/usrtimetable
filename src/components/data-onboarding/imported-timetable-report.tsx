import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReportShell } from "@/components/reports/report-shell";
import {
  filterImportedTimetable,
  importedTimetableRows,
  IMPORTED_TIMETABLE_HEADERS,
  type ImportedSource,
  type ImportedReportFilters,
} from "@/lib/reports/imported-timetable";

const INITIAL: ImportedReportFilters = {
  kind: "timetable",
  department: "all",
  level: "all",
  teacher: "all",
  room: "all",
  search: "",
};

export function ImportedTimetableReport({
  sources,
  collegeId,
  termId,
  termName,
  plans,
  onBack,
  isLoading,
}: {
  sources: ImportedSource[];
  collegeId: string;
  termId: string;
  termName?: string;
  plans: ReadonlyMap<string, string>;
  onBack: () => void;
  isLoading: boolean;
}) {
  const [filters, setFilters] = useState(INITIAL);
  const all = importedTimetableRows(sources, { collegeId, termId }, plans);
  const rows = filterImportedTimetable(all, filters);
  const change = (field: keyof ImportedReportFilters, value: string) =>
    setFilters((previous) => ({ ...previous, [field]: value }));
  const summary = [
    filters.kind === "all"
      ? "جميع المصادر"
      : filters.kind === "timetable"
        ? "الجداول الدراسية"
        : "كشوف الإسناد",
    ...[filters.department, filters.level, filters.teacher, filters.room].filter(
      (value) => value !== "all",
    ),
    filters.search,
  ]
    .filter(Boolean)
    .join(" · ");
  const selectors = [
    { field: "department", label: "القسم / البرنامج في المصدر" },
    { field: "level", label: "المستوى" },
    { field: "teacher", label: "المحاضر كما ورد في المصدر" },
    { field: "room", label: "القاعة كما وردت في المصدر" },
  ] as const;
  return (
    <ReportShell
      title="تقرير الجداول المستوردة"
      description="المقررات والمحاضرون والمواعيد والقاعات كما وردت في الملفات، بما فيها الصفوف التي لم يكتمل ربطها. هذا تقرير للمصدر وليس إثباتًا لاكتمال الإسناد أو اعتماد الجدول. أسماء المحاضرين المختصرة لا تُدمج تلقائيًا."
      headerMeta={{ termName, official: false, readOnly: true }}
      filterSummary={summary}
      filename="imported_timetable"
      rows={rows}
      headers={IMPORTED_TIMETABLE_HEADERS}
      isLoading={isLoading}
      kpis={[
        { label: "صفوف المصدر المعروضة", value: rows.length },
        { label: "مواعيد غير مكتملة", value: rows.filter((r) => r.missingTime).length },
        { label: "مرتبطة بجلسة", value: rows.filter((r) => r.sessionLinked).length },
        { label: "جميع صفوف المصدر", value: all.length },
      ]}
      filters={
        <div className="report-no-print space-y-3 rounded-lg border p-4">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={onBack}>
              العودة إلى استكمال الجداول
            </Button>
            <Button variant="ghost" onClick={() => setFilters(INITIAL)}>
              إزالة الفلاتر
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-sm">
              نوع المصدر
              <select
                aria-label="نوع المصدر"
                className="w-full rounded border bg-background p-2"
                value={filters.kind}
                onChange={(e) => change("kind", e.target.value)}
              >
                <option value="timetable">الجداول الدراسية</option>
                <option value="assignment">كشوف الإسناد</option>
                <option value="all">جميع المصادر</option>
              </select>
            </label>
            {selectors.map(({ field, label }) => (
              <label className="space-y-1 text-sm" key={field}>
                {label}
                <select
                  aria-label={label}
                  className="w-full rounded border bg-background p-2"
                  value={filters[field]}
                  onChange={(e) => change(field, e.target.value)}
                >
                  <option value="all">الكل</option>
                  {[...new Set(all.map((row) => row[field]))]
                    .sort((a, b) => a.localeCompare(b, "ar", { numeric: true }))
                    .map((value) => (
                      <option key={value} value={value}>
                        {value || "غير مذكور"}
                      </option>
                    ))}
                </select>
              </label>
            ))}
            <label className="space-y-1 text-sm">
              بحث في المقرر أو الرمز أو المصدر
              <Input
                aria-label="بحث في تقرير الجداول المستوردة"
                value={filters.search}
                onChange={(e) => change("search", e.target.value)}
              />
            </label>
          </div>
        </div>
      }
      summary={
        <p className="text-sm">
          تظهر كشوف الإسناد منفصلة عن المواعيد لتجنب احتساب المحاضرة نفسها مرتين. مدة الموعد لا تمثل
          وحدها نصاب المحاضر أو الساعات الزائدة. الحقل الفارغ يُعرض «غير مذكور» ويبقى فارغًا في
          التصدير.
        </p>
      }
    >
      <div className="overflow-x-auto print:overflow-visible">
        <table
          className="w-full border-collapse text-right text-xs"
          aria-label="صفوف الجداول المستوردة"
        >
          <thead>
            <tr>
              {[
                "القسم / المستوى",
                "المقرر",
                "المحاضر",
                "اليوم / الوقت",
                "القاعة",
                "المصدر / المراجعة",
              ].map((label) => (
                <th className="border p-2" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className="break-inside-avoid align-top"
                data-source-id={row.sourceId}
              >
                <td className="border p-2">
                  {row.department}
                  <br />
                  المستوى {row.level}
                </td>
                <td className="border p-2">
                  {row.course || "غير مذكور"}
                  <br />
                  <span dir="ltr">{row.courseCode}</span>
                </td>
                <td className="border p-2">{row.teacher || "غير مذكور"}</td>
                <td className="border p-2">
                  {row.day || "غير مذكور"}
                  <br />
                  {row.rawTime || "الوقت غير مذكور"}
                  {row.start && row.end && (
                    <p dir="ltr">
                      {row.start} – {row.end}
                    </p>
                  )}
                </td>
                <td className="border p-2">{row.room || "غير مذكورة"}</td>
                <td className="border p-2">
                  <p>{row.status}</p>
                  <p>{row.review}</p>
                  <p className="break-words">
                    {row.sourceFile} — {row.sourceCell}
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
