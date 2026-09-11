import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { DAY_LABELS_AR } from "@/lib/time-templates/weekly-generator";
import {
  EMPTY_TEMPLATE_FILTERS, TEMPLATE_SYSTEM_LABELS, TEMPLATE_PAGE_SIZE, filterTimeTemplates,
  templateDayCounts, timeTemplatePage, type TemplateFilters, type TemplateScope, type TimeTemplateRow,
} from "@/lib/time-templates/template-directory";

interface Props {
  rows: TimeTemplateRow[];
  isLoading: boolean;
  error: Error | null;
  onRetry: () => void;
  canManage: boolean;
  pending: boolean;
  onToggle: (row: TimeTemplateRow) => void;
  onDelete: (row: TimeTemplateRow) => void;
}
const selectClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

export function TemplateDirectory({ rows, isLoading, error, onRetry, canManage, pending, onToggle, onDelete }: Props) {
  const [filters, setFilters] = useState<TemplateFilters>(EMPTY_TEMPLATE_FILTERS);
  const [day, setDay] = useState<number | "all">("all");
  const [requestedPage, setPage] = useState(1);
  const filtered = useMemo(() => filterTimeTemplates(rows, filters), [rows, filters]);
  const dayCounts = useMemo(() => templateDayCounts(filtered), [filtered]);
  const page = timeTemplatePage(filtered, day, requestedPage);
  const availableView = filters.scope.startsWith("available_");
  const hasFilters = day !== "all" || Object.entries(EMPTY_TEMPLATE_FILTERS).some(([key, value]) => filters[key as keyof TemplateFilters] !== value);
  const update = (next: Partial<TemplateFilters>) => { setFilters((old) => ({ ...old, ...next })); setPage(1); };
  const chooseDay = (next: number | "all") => { setDay(next); setPage(1); };
  const clear = () => { setFilters(EMPTY_TEMPLATE_FILTERS); setDay("all"); setPage(1); };
  const durationOptions = [...new Set(rows.map((row) => row.slot_duration_minutes))].sort((a, b) => a - b);
  const title = day === "all" ? "قوالب جميع الأيام" : "قوالب " + (DAY_LABELS_AR[day] ?? day);
  const summary = [
    ["إجمالي القوالب", rows.length],
    ["مشتركة للعام والموازي", rows.filter((r) => r.study_system === "both").length],
    ["مخصصة للعام", rows.filter((r) => r.study_system === "regular").length],
    ["مخصصة للموازي", rows.filter((r) => r.study_system === "parallel").length],
  ] as const;
  const actions = (row: TimeTemplateRow) => canManage && (
    <div className="flex items-center gap-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => onToggle(row)}
        aria-label={(row.is_active ? "تعطيل" : "تفعيل") + " قالب " + DAY_LABELS_AR[row.day_of_week] + " " + row.start_time.slice(0, 5) + " " + TEMPLATE_SYSTEM_LABELS[row.study_system]}>
        {row.is_active ? "تعطيل" : "تفعيل"}
      </Button>
      <Button type="button" size="icon" variant="ghost" disabled={pending} onClick={() => onDelete(row)}
        aria-label={"حذف قالب " + DAY_LABELS_AR[row.day_of_week] + " " + row.start_time.slice(0, 5) + " إلى " + row.end_time.slice(0, 5) + " " + TEMPLATE_SYSTEM_LABELS[row.study_system]}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
  const status = (row: TimeTemplateRow) => <span className={"inline-flex rounded-full px-2 py-1 text-xs " + (row.is_active ? "bg-emerald-50 text-emerald-800" : "bg-muted text-muted-foreground")}>{row.is_active ? "مفعّل" : "معطّل"}</span>;

  return (
    <section aria-label="القوالب المحفوظة" data-testid="time-template-directory" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">القوالب المحفوظة</h2>
        <p className="text-xs text-muted-foreground">القالب المشترك يُستخدم للعام والموازي معاً.</p>
      </div>
      {!isLoading && !error && <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {summary.map(([label, count]) => <Card key={label} className="flex flex-wrap items-center justify-between gap-2 p-4"><span className="text-xs text-muted-foreground">{label}</span><strong className="text-2xl text-primary">{count}</strong></Card>)}
      </div>}
      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <label className="min-w-0 space-y-1 text-xs">نطاق عرض القوالب
            <select className={selectClass} value={filters.scope} onChange={(e) => {
              const scope = e.target.value as TemplateScope;
              update({ scope, activity: scope.startsWith("available_") ? "active" : "all" });
            }}>
              <option value="all">جميع القوالب المحفوظة</option>
              <optgroup label="القوالب المفعّلة المتاحة لكل نظام">
                <option value="available_regular">المتاحة للعام — تشمل المشتركة</option>
                <option value="available_parallel">المتاحة للموازي — تشمل المشتركة</option>
              </optgroup>
              <optgroup label="حسب التصنيف المحفوظ فقط">
                <option value="both">المشتركة للعام والموازي فقط</option>
                <option value="regular">المخصصة للعام فقط</option>
                <option value="parallel">المخصصة للموازي فقط</option>
              </optgroup>
            </select>
          </label>
          <label className="space-y-1 text-xs">مدة القالب
            <select className={selectClass} value={filters.duration} onChange={(e) => update({ duration: e.target.value })}>
              <option value="all">جميع المدد</option>
              {durationOptions.map((duration) => <option key={duration} value={duration}>{duration === 120 ? "ساعتان — 120 دقيقة" : duration === 180 ? "ثلاث ساعات — 180 دقيقة" : duration + " دقيقة"}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs">حالة القالب
            <select className={selectClass} value={filters.activity} disabled={availableView} onChange={(e) => update({ activity: e.target.value as TemplateFilters["activity"] })}>
              <option value="all">جميع الحالات</option><option value="active">مفعّل</option><option value="inactive">معطّل</option>
            </select>
          </label>
          {hasFilters && <Button type="button" variant="ghost" className="self-end" onClick={clear}>مسح الفلاتر</Button>}
        </div>
        <p className="text-xs leading-6 text-muted-foreground">
          {availableView ? "يعرض هذا الخيار القوالب المفعّلة المخصصة للنظام مع القوالب المشتركة. اعتماد الفترة في الجدول يخضع لبقية شروط الجدولة." : "التصنيف يحدد من يستطيع استخدام القالب. القوالب فترات بديلة تختار منها الجدولة؛ تداخلها الزمني لا يعني وجود تعارض في الجدول."}
        </p>
        {!isLoading && !error && <div role="group" aria-label="تصفية القوالب حسب اليوم" className="space-y-2">
          <Button type="button" size="sm" variant={day === "all" ? "default" : "outline"} aria-pressed={day === "all"} onClick={() => chooseDay("all")}>جميع الأيام ({filtered.length})</Button>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {dayCounts.map(([dayNumber, count]) => <button key={dayNumber} type="button" aria-pressed={day === dayNumber}
              aria-controls="saved-template-results" onClick={() => chooseDay(dayNumber)}
              className={"rounded-lg border p-3 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " + (day === dayNumber ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50")}>
              <span className="block text-sm font-medium">{DAY_LABELS_AR[dayNumber] ?? dayNumber}</span><strong className="mt-1 block text-xl">{count}</strong><span className="text-xs text-muted-foreground">قالب</span>
            </button>)}
          </div>
        </div>}
      </Card>
      <Card id="saved-template-results" className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-4">
          <h3 className="font-semibold">{title}</h3>
          {!isLoading && !error && <p role="status" className="text-xs text-muted-foreground">{page.total} قالب · مرتبة حسب اليوم ثم البداية والنهاية</p>}
        </div>
        {isLoading ? <p className="p-8 text-center text-muted-foreground">جارٍ تحميل القوالب…</p>
          : error ? <div className="space-y-3 p-8 text-center"><p>تعذر تحميل القوالب. أعد المحاولة.</p><Button type="button" variant="outline" onClick={onRetry}>إعادة المحاولة</Button></div>
          : page.total === 0 ? <div className="space-y-2 p-8 text-center"><p>لا توجد قوالب تطابق هذا الاختيار.</p>{hasFilters && <Button type="button" variant="outline" onClick={clear}>عرض جميع القوالب</Button>}</div>
          : <>
            <div className="hidden max-h-[36rem] overflow-auto xl:block">
              <table className="w-full text-sm" aria-label={title}>
                <thead className="sticky top-0 bg-muted"><tr>{["اليوم", "البداية", "النهاية", "المدة", "التصنيف", "الحالة", ...(canManage ? ["الإجراءات"] : [])].map((label) => <th key={label} scope="col" className="px-3 py-3 text-right text-xs font-medium text-muted-foreground">{label}</th>)}</tr></thead>
                <tbody>{page.rows.map((row) => <tr key={row.id} className="border-t hover:bg-muted/30">
                  <th scope="row" className="px-3 py-3 text-right font-medium">{DAY_LABELS_AR[row.day_of_week] ?? row.day_of_week}</th>
                  <td className="px-3 py-3 tabular-nums"><span dir="ltr">{row.start_time.slice(0, 5)}</span></td>
                  <td className="px-3 py-3 tabular-nums"><span dir="ltr">{row.end_time.slice(0, 5)}</span></td>
                  <td className="px-3 py-3 whitespace-nowrap">{row.slot_duration_minutes} دقيقة</td>
                  <td className="px-3 py-3"><span className={row.study_system === "both" ? "font-medium text-primary" : ""}>{TEMPLATE_SYSTEM_LABELS[row.study_system]}</span></td>
                  <td className="px-3 py-3">{status(row)}</td>{canManage && <td className="px-3 py-3">{actions(row)}</td>}
                </tr>)}</tbody>
              </table>
            </div>
            <ul className="max-h-[36rem] divide-y overflow-y-auto xl:hidden" aria-label={title}>{page.rows.map((row) => <li key={row.id} className="space-y-3 p-4">
              <div className="flex items-center justify-between gap-2"><strong>{DAY_LABELS_AR[row.day_of_week] ?? row.day_of_week}</strong>{status(row)}</div>
              <div className="flex flex-wrap items-center justify-between gap-2"><span dir="ltr" className="text-lg font-semibold tabular-nums">{row.start_time.slice(0, 5)} → {row.end_time.slice(0, 5)}</span><span className="text-sm">{row.slot_duration_minutes} دقيقة</span></div>
              <p className="text-sm text-primary">{TEMPLATE_SYSTEM_LABELS[row.study_system]}</p>{actions(row)}
            </li>)}</ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-xs text-muted-foreground">
              <span>صفحة {page.page} من {page.pageCount} · عرض {(page.page - 1) * TEMPLATE_PAGE_SIZE + 1}–{(page.page - 1) * TEMPLATE_PAGE_SIZE + page.rows.length} من {page.total}</span>
              <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={page.page === 1} onClick={() => setPage(page.page - 1)}><ChevronRight className="h-4 w-4" />السابق</Button><Button type="button" size="sm" variant="outline" disabled={page.page === page.pageCount} onClick={() => setPage(page.page + 1)}>التالي<ChevronLeft className="h-4 w-4" /></Button></div>
            </div>
          </>}
      </Card>
    </section>
  );
}
