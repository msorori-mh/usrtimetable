/**
 * Read-only drill-down for every leadership metric card.
 *
 * Opens the constituent records behind a number through the read-only RPC
 * `leadership_metric_details`, verifies that the detail total equals the card
 * value, and falls back to «يحتاج مراجعة» with the difference when it does not.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  LEADERSHIP_ASSIGNMENT_STATUS_LABELS,
  LEADERSHIP_DETAIL_COLUMNS,
  LEADERSHIP_METRICS,
  LEADERSHIP_NEEDS_REVIEW,
  LEADERSHIP_UNCALCULATED,
  detailCollegeOptions,
  detailHoursKey,
  filterDetailRows,
  leadershipDetailsSchema,
  reconcileMetric,
  sumDetailColumn,
  type LeadershipMetricKey,
} from "@/lib/reports/leadership-metrics";

const ALL_COLLEGES = "__all__";

export interface LeadershipDrilldownTarget {
  metric: LeadershipMetricKey;
  cardValue: number | null;
  collegeId?: string | null;
  collegeName?: string | null;
}

function cellText(value: unknown, key: string): string {
  if (value === null || value === undefined || value === "") return LEADERSHIP_UNCALCULATED;
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "number") return value.toLocaleString("ar");
  if (key === "assignment_status")
    return LEADERSHIP_ASSIGNMENT_STATUS_LABELS[String(value)] ?? String(value);
  return String(value);
}

export function LeadershipMetricDrilldown({
  target,
  period,
  onClose,
}: {
  target: LeadershipDrilldownTarget | null;
  period: { year: string | null; type: string | null } | null;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [college, setCollege] = useState(ALL_COLLEGES);
  const definition = target ? LEADERSHIP_METRICS[target.metric] : null;

  const query = useQuery({
    enabled: !!definition,
    queryKey: [
      "leadership-metric-details",
      definition?.source,
      period.year,
      period.type,
      target?.collegeId ?? null,
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
        p_metric: definition!.source,
        p_academic_year: period.year,
        p_term_type: period.type,
        p_college_id: target?.collegeId ?? null,
      });
      if (error) throw new Error("تعذر تحميل تفاصيل المؤشر. أعد المحاولة.");
      return leadershipDetailsSchema.parse(data);
    },
  });

  const rows = query.data?.rows ?? [];
  const colleges = useMemo(() => detailCollegeOptions(rows), [rows]);
  const visible = useMemo(
    () =>
      filterDetailRows(rows, {
        search,
        collegeId: college === ALL_COLLEGES ? null : college,
      }),
    [rows, search, college],
  );

  const columns = definition ? LEADERSHIP_DETAIL_COLUMNS[definition.source] : [];
  const detailTotal = definition ? (query.data?.totals?.[definition.totalKey] ?? null) : null;
  const check = reconcileMetric(target?.cardValue ?? null, detailTotal);
  const hoursKey = definition ? detailHoursKey(definition.source) : "";
  const visibleHours = sumDetailColumn(visible, hoursKey);
  const filename = `leadership_${definition?.id ?? "metric"}_${period.year ?? ""}`;

  return (
    <Sheet
      open={!!target}
      onOpenChange={(open) => {
        if (!open) {
          setSearch("");
          setCollege(ALL_COLLEGES);
          onClose();
        }
      }}
    >
      <SheetContent
        side="left"
        className="flex w-full flex-col gap-4 sm:max-w-3xl"
        data-testid="leadership-drilldown"
      >
        <SheetHeader className="text-start">
          <SheetTitle>{definition?.label ?? "تفاصيل المؤشر"}</SheetTitle>
          <SheetDescription>
            {definition?.definition}
            {target?.collegeName ? ` · الكلية: ${target.collegeName}` : ""}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-2 rounded border p-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">رقم البطاقة</div>
            <b className="tabular-nums" data-testid="drilldown-card-value">
              {target?.cardValue === null || target?.cardValue === undefined
                ? LEADERSHIP_UNCALCULATED
                : target.cardValue.toLocaleString("ar")}
            </b>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">إجمالي التفاصيل</div>
            <b className="tabular-nums" data-testid="drilldown-detail-total">
              {detailTotal === null ? LEADERSHIP_UNCALCULATED : detailTotal.toLocaleString("ar")}
            </b>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">المطابقة</div>
            {check.status === "ok" ? (
              <Badge variant="default">مطابق</Badge>
            ) : check.status === "needs_review" ? (
              <Badge variant="destructive" data-testid="drilldown-mismatch">
                {LEADERSHIP_NEEDS_REVIEW} · الفرق {check.difference?.toLocaleString("ar")}
              </Badge>
            ) : (
              <Badge variant="outline">{LEADERSHIP_UNCALCULATED}</Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute end-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="بحث في السجلات"
              aria-label="بحث في سجلات المؤشر"
            />
          </div>
          {colleges.length > 1 && (
            <Select value={college} onValueChange={setCollege}>
              <SelectTrigger className="w-[190px]" aria-label="تصفية الكلية">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_COLLEGES}>جميع الكليات</SelectItem>
                {colleges.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={() => downloadCSV(visible, columns, filename)}
          >
            <Download className="ml-1 h-4 w-4" />
            CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={visible.length === 0}
            onClick={() => downloadXLSX(visible, columns, filename, "details")}
          >
            Excel
          </Button>
        </div>

        <div className="text-xs text-muted-foreground" data-testid="drilldown-counts">
          {visible.length.toLocaleString("ar")} سجلًا · إجمالي الساعات{" "}
          {visibleHours.toLocaleString("ar")}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded border">
          {query.isFetching ? (
            <p className="p-4 text-sm text-muted-foreground">جارٍ تحميل السجلات…</p>
          ) : query.error ? (
            <div className="space-y-2 p-4 text-sm">
              <p className="text-destructive">تعذر تحميل تفاصيل المؤشر.</p>
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                إعادة المحاولة
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              لا توجد سجلات مطابقة لهذا المؤشر في النطاق المحدد.
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-right text-xs">
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
                {visible.map((row, index) => (
                  <tr key={`${String(row.id ?? index)}-${index}`} className="border-t">
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={
                          column.numeric ? "p-2 tabular-nums" : "p-2 whitespace-pre-wrap"
                        }
                      >
                        {cellText(row[column.key], column.key)}
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
