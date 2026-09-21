import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadCSV, downloadXLSX } from "@/lib/reports/export";
import {
  LEADERSHIP_METRICS,
  assignmentCoveragePercent,
  dedupePublishedSessions,
  detailCollegeOptions,
  detailDepartmentOptions,
  filterDetailRows,
  leadershipDetailSchema,
  reconcileMetric,
  sumDetailColumn,
  uniqueFacultyCount,
  type LeadershipDetailRow,
  type LeadershipMetricKey,
} from "@/lib/reports/leadership-metrics";

const LABELS: Record<string, string> = {
  name: "المحاضر",
  university_number: "الرقم الجامعي",
  college: "الكلية",
  department: "القسم",
  program: "البرنامج",
  status: "الحالة",
  rank: "الرتبة",
  employment_type: "نوع التعاقد",
  base_quota: "النصاب الأساسي",
  release_hours: "الإعفاء",
  required_hours: "المطلوب بعد الإعفاء",
  assigned_hours: "المسند ضمن النصاب",
  scheduled_hours: "المجدول في المنشور",
  deficit_hours: "نقص النصاب",
  overload_hours: "الساعات الزائدة",
  teaching_colleges: "كليات التدريس",
  incomplete_reason: "سبب النقص",
  study_system: "نظام الدراسة",
  cohort: "الدفعة",
  course_code: "رمز المقرر",
  course: "المقرر",
  component_type: "نوع المكوّن",
  group_code: "المجموعة",
  covered_hours: "الساعات المغطاة بإسناد",
  uncovered_hours: "ساعات غير مسندة",
  assignment_status: "حالة الإسناد",
  pending_distribution: "بانتظار التوزيع",
  instructors: "المحاضرون",
  term: "الفصل",
  version: "النسخة",
  published: "منشورة",
  version_updated_at: "آخر تحديث للنسخة",
  sessions_count: "عدد المحاضرات",
  teaching_hours: "ساعات التدريس",
  theory_hours: "نظري",
  practical_hours: "عملي",
  unplaced_sessions: "جلسات بلا قاعة",
  used_rooms: "قاعات مستخدمة",
};

const HIDDEN = new Set(["identity_id", "delivery_group_id", "college_id", "in_quota_scope"]);

export type LeadershipDrilldownRequest = {
  metric: LeadershipMetricKey;
  /** القيمة المعروضة في البطاقة، للتحقق من التطابق. */
  cardValue: number | null;
  collegeId?: string | null;
  collegeName?: string | null;
};

export function LeadershipMetricDrilldown({
  request,
  period,
  onOpenChange,
}: {
  request: LeadershipDrilldownRequest | null;
  period: { year: string | null; type: string | null } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [college, setCollege] = useState("all");
  const [department, setDepartment] = useState("all");
  const definition = request ? LEADERSHIP_METRICS[request.metric] : null;

  const query = useQuery({
    enabled: !!request && !!definition,
    queryKey: [
      "leadership-metric-details",
      definition?.source,
      period?.year ?? null,
      period?.type ?? null,
      request?.collegeId ?? null,
    ],
    staleTime: 60_000,
    queryFn: async () => {
      const client = supabase as unknown as {
        rpc: (
          fn: string,
          args: Record<string, unknown>,
        ) => Promise<{ data: unknown; error: { message: string } | null }>;
      };
      const { data, error } = await client.rpc("leadership_metric_details", {
        p_metric: definition?.source ?? "faculty",
        p_academic_year: period?.year ?? null,
        p_term_type: period?.type ?? null,
        p_college_id: request?.collegeId ?? null,
      });
      if (error) throw new Error("تعذر تحميل السجلات المكوّنة لهذا المؤشر.");
      return leadershipDetailSchema.parse(data);
    },
  });

  const allRows: LeadershipDetailRow[] = useMemo(() => {
    const rows = query.data?.rows ?? [];
    if (definition?.source === "schedules") return dedupePublishedSessions(rows);
    if (definition?.key === "available_faculty")
      return rows.filter((row) => row["status"] === "متاح");
    return rows;
  }, [query.data, definition?.source, definition?.key]);

  const rows = useMemo(
    () => filterDetailRows(allRows, { search, college, department }),
    [allRows, search, college, department],
  );

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const row of allRows)
      for (const key of Object.keys(row)) if (!HIDDEN.has(key)) keys.add(key);
    return [...keys].map((key) => ({ key, label: LABELS[key] ?? key }));
  }, [allRows]);

  const detailTotal = definition
    ? definition.countsRecords
      ? definition.source === "faculty"
        ? uniqueFacultyCount(rows)
        : rows.length
      : sumDetailColumn(rows, definition.detailColumn)
    : null;
  const hoursTotal = sumDetailColumn(rows, definition?.detailColumn ?? null);
  const untouched = search === "" && college === "all" && department === "all";
  const check =
    definition && request && untouched ? reconcileMetric(request.cardValue, detailTotal) : null;
  const coverageHint =
    definition?.key === "assignment_coverage"
      ? assignmentCoveragePercent({
          required: sumDetailColumn(rows, "required_hours"),
          covered: sumDetailColumn(rows, "covered_hours"),
        })
      : null;

  const filename = `leadership_${definition?.key ?? "metric"}_${period?.year ?? ""}_${period?.type ?? ""}`;

  return (
    <Sheet
      open={!!request}
      onOpenChange={(open) => {
        if (!open) {
          setSearch("");
          setCollege("all");
          setDepartment("all");
        }
        onOpenChange(open);
      }}
    >
      <SheetContent side="left" className="flex w-full max-w-3xl flex-col gap-3 sm:max-w-3xl">
        <SheetHeader className="text-right">
          <SheetTitle>{definition?.label ?? "تفاصيل المؤشر"}</SheetTitle>
          <SheetDescription>
            {definition?.definition}
            {request?.collegeName ? ` · ${request.collegeName}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant="secondary">عدد السجلات: {rows.length.toLocaleString("ar")}</Badge>
          <Badge variant="secondary">
            الإجمالي: {hoursTotal === null ? "غير محسوب" : hoursTotal.toLocaleString("ar")}
            {definition?.unit === "hours" ? " ساعة" : ""}
          </Badge>
          {coverageHint !== null && <Badge variant="outline">التغطية: {coverageHint}%</Badge>}
          {check?.status === "needs_review" && (
            <Badge variant="destructive">
              يحتاج مراجعة
              {check.difference === null ? "" : ` · الفرق ${check.difference.toLocaleString("ar")}`}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="بحث في السجلات"
            aria-label="بحث في السجلات"
            className="w-full sm:w-56"
          />
          <Select value={college} onValueChange={setCollege}>
            <SelectTrigger className="w-full sm:w-48" aria-label="تصفية الكلية">
              <SelectValue placeholder="الكلية" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الكليات</SelectItem>
              {detailCollegeOptions(allRows).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {detailDepartmentOptions(allRows).length > 0 && (
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger className="w-full sm:w-48" aria-label="تصفية القسم">
                <SelectValue placeholder="القسم" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام</SelectItem>
                {detailDepartmentOptions(allRows).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => downloadCSV(rows, columns, filename)}
          >
            تصدير CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => downloadXLSX(rows, columns, filename, "تفاصيل")}
          >
            تصدير Excel
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded border">
          {query.isFetching ? (
            <p className="p-6 text-center text-sm text-muted-foreground">جارٍ تحميل السجلات…</p>
          ) : query.error ? (
            <p className="p-6 text-center text-sm text-destructive">
              تعذر تحميل السجلات المكوّنة لهذا المؤشر.
            </p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              لا توجد سجلات مطابقة لهذا المؤشر بالمعايير الحالية.
            </p>
          ) : (
            <table className="w-full text-right text-xs">
              <thead className="sticky top-0 bg-muted">
                <tr>
                  {columns.map((column) => (
                    <th key={column.key} className="whitespace-nowrap p-2 font-semibold">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} className="border-t align-top">
                    {columns.map((column) => (
                      <td key={column.key} className="p-2">
                        {row[column.key] === null || row[column.key] === undefined
                          ? "—"
                          : typeof row[column.key] === "boolean"
                            ? row[column.key]
                              ? "نعم"
                              : "لا"
                            : String(row[column.key])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
