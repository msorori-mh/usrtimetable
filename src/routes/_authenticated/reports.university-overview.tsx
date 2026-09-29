import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  Maximize2,
  Minimize2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { canViewLeadership } from "@/lib/viewer-roles";
import { UnauthorizedAccess } from "@/components/unauthorized-access";
import { ReportShell } from "@/components/reports/report-shell";
import { ReportScopeError } from "@/lib/reports/preferences";
import {
  CollegeOverviewCard,
  UniversitySummary,
} from "@/components/reports/university-overview-report";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchUniversityOverview } from "@/lib/reports/fetch-university-overview";
import {
  buildUniversityOverview,
  type OverviewSourceMode,
} from "@/lib/reports/university-overview";
import { termTypeLabel } from "@/lib/reports/leadership";
import { leadershipViewerKey, LEADERSHIP_QUERY_POLICY } from "@/lib/reports/leadership-decisions";
import "@/components/reports/university-overview.css";

export const Route = createFileRoute("/_authenticated/reports/university-overview")({
  head: () => ({ meta: [{ title: "التقرير التنفيذي الشامل | جامعة إقليم سبأ" }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { year?: string; term?: string; college?: string; source?: OverviewSourceMode } => ({
    year:
      typeof search.year === "string" && /^\d{4}-\d{4}$/.test(search.year)
        ? search.year
        : undefined,
    term:
      typeof search.term === "string" && /^[a-z0-9_-]{1,40}$/i.test(search.term)
        ? search.term
        : undefined,
    college:
      typeof search.college === "string" && /^[0-9a-f-]{36}$/i.test(search.college)
        ? search.college
        : undefined,
    source: search.source === "published" ? "published" : "presentation",
  }),
  component: Page,
});

function Page() {
  const { data: me, isLoading } = useCurrentUser();
  if (isLoading) return <Card className="p-6">جارٍ التحقق من الصلاحيات…</Card>;
  if (!me || !canViewLeadership(me)) return <UnauthorizedAccess />;
  return (
    <UniversityOverviewPage key={leadershipViewerKey(me)} viewerKey={leadershipViewerKey(me)} />
  );
}

function UniversityOverviewPage({ viewerKey }: { viewerKey: string }) {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [textSearch, setTextSearch] = useState("");
  const [presentation, setPresentation] = useState(false);
  const [slide, setSlide] = useState(0);
  const mode = search.source ?? "presentation";
  const period = search.year && search.term ? { year: search.year, type: search.term } : null;
  const query = useQuery({
    queryKey: ["university-executive-overview", viewerKey, period],
    ...LEADERSHIP_QUERY_POLICY,
    retry: false,
    queryFn: () => fetchUniversityOverview(period),
  });
  const report = useMemo(() => {
    try {
      return {
        rows: query.data?.sources ? buildUniversityOverview(query.data.sources, mode) : [],
        error: null,
      };
    } catch (error) {
      return {
        rows: [],
        error: new ReportScopeError(
          error instanceof Error ? error.message : "تعذر التحقق من بيانات التقرير",
        ),
      };
    }
  }, [query.data, mode]);
  const rows = report.rows;
  const normalized = (v: string) =>
    v
      .normalize("NFKD")
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[أإآ]/g, "ا")
      .toLowerCase()
      .trim();
  const needle = normalized(textSearch);
  const selected = rows.filter(
    (c) =>
      (!search.college || c.id === search.college) &&
      (!needle ||
        normalized([c.name, ...c.departments.map((d) => d.name)].join(" ")).includes(needle)),
  );
  const currentSlide = Math.min(slide, selected.length);
  const showCollege = presentation && currentSlide > 0 ? selected[currentSlide - 1] : null;
  const data = query.data?.overview;
  const periodLabel = data?.year
    ? `${data.year} · ${termTypeLabel(data.term_type ?? "")}`
    : "الفصل غير محدد";
  const allScope = !search.college && !textSearch.trim();
  const sourceLabel =
    mode === "published" ? "الجداول المنشورة" : "المنشور مع أحدث مسودة مكتملة للحاسوب";
  const update = (patch: Partial<typeof search>) => {
    setSlide(0);
    void navigate({ search: (prior) => ({ ...prior, ...patch }) });
  };
  const selectCollege = (id: string) => {
    if (presentation) setSlide(selected.findIndex((c) => c.id === id) + 1);
    else update({ college: id });
  };
  useEffect(() => {
    if (!presentation) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresentation(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presentation]);
  const exportRows = selected.map((c) => ({
    college: c.name,
    departments: c.departmentCount,
    programs: c.programCount,
    courses: c.courseCount,
    required: c.requiredHours,
    scheduled: c.scheduledHours,
    faculty: c.facultyCount,
    hallCount: c.halls.count,
    hallSeats: c.halls.seats,
    hallCapacity: c.halls.capacityHours,
    hallUsed: c.halls.occupiedHours,
    hallFree: c.halls.freeHours,
    labCount: c.labs.count,
    labSeats: c.labs.seats,
    labCapacity: c.labs.capacityHours,
    labUsed: c.labs.occupiedHours,
    labFree: c.labs.freeHours,
    version: c.source?.name ?? "لا توجد",
    status: c.source?.status ?? "غير متاح",
    notes: c.issues.join("؛ "),
  }));
  const headers = [
    ["college", "الكلية"],
    ["departments", "الأقسام"],
    ["programs", "البرامج"],
    ["courses", "المقررات المطروحة"],
    ["required", "الساعات المطلوبة"],
    ["scheduled", "الساعات المجدولة"],
    ["faculty", "الكادر التابع للكلية"],
    ["hallCount", "عدد القاعات"],
    ["hallSeats", "مقاعد القاعات"],
    ["hallCapacity", "طاقة القاعات بالساعات"],
    ["hallUsed", "ساعات القاعات المستخدمة"],
    ["hallFree", "ساعات القاعات غير المشغولة"],
    ["labCount", "عدد المعامل"],
    ["labSeats", "مقاعد المعامل"],
    ["labCapacity", "طاقة المعامل بالساعات"],
    ["labUsed", "ساعات المعامل المستخدمة"],
    ["labFree", "ساعات المعامل غير المشغولة"],
    ["version", "نسخة الجدول"],
    ["status", "حالة النسخة"],
    ["notes", "الملاحظات"],
  ].map(([key, label]) => ({ key, label }));
  return (
    <div className={`university-overview ${presentation ? "uo-presentation" : ""}`} dir="rtl">
      {presentation && (
        <div className="uo-presentation-nav report-no-print">
          <Button variant="outline" onClick={() => setPresentation(false)}>
            <Minimize2 size={16} />
            إنهاء العرض
          </Button>
          <div>
            <Button
              aria-label="الشريحة السابقة"
              variant="ghost"
              disabled={currentSlide === 0}
              onClick={() => setSlide(currentSlide - 1)}
            >
              <ChevronRight size={20} />
            </Button>
            <Button variant="ghost" onClick={() => setSlide(0)}>
              <LayoutDashboard size={16} />
              الملخص
            </Button>
            <Button
              aria-label="الشريحة التالية"
              variant="ghost"
              disabled={currentSlide === selected.length}
              onClick={() => setSlide(currentSlide + 1)}
            >
              <ChevronLeft size={20} />
            </Button>
          </div>
          <span>
            {currentSlide + 1} / {selected.length + 1}
          </span>
        </div>
      )}
      <ReportShell
        title="التقرير التنفيذي الشامل"
        description="ملخص الكليات واحتياج الأقسام التدريسي وسعة القاعات والمعامل واستخدامها والكادر الأكاديمي."
        filename={`university_overview_${data?.year ?? ""}_${data?.term_type ?? ""}`}
        filterSummary={`${periodLabel} · ${sourceLabel}${search.college ? ` · ${selected[0]?.name ?? "كلية غير متاحة"}` : ""}`}
        headerMeta={{
          collegeName: search.college
            ? (selected[0]?.name ?? "كلية غير متاحة")
            : "الكليات المتاحة في نطاق الحساب",
          termName: periodLabel,
          note: sourceLabel,
        }}
        shareParams={{
          year: data?.year,
          term: data?.term_type,
          college: search.college,
          source: mode,
        }}
        rows={exportRows}
        headers={headers}
        isLoading={query.isPending}
        error={report.error ?? (query.data ? null : query.error)}
        onRetry={() => {
          void query.refetch();
        }}
        emptyMessage={
          rows.length
            ? "لا توجد كلية أو أقسام تطابق البحث."
            : "لا توجد كليات مصرح بها في هذا الفصل."
        }
        filters={
          <div className="uo-controls report-no-print">
            <label>
              الفصل الدراسي
              <select
                value={data?.year && data.term_type ? `${data.year}|${data.term_type}` : ""}
                onChange={(e) => {
                  const [year, term] = e.target.value.split("|");
                  update({ year, term, college: undefined });
                }}
              >
                <option value="" disabled>
                  اختر الفصل
                </option>
                {data?.periods.map((p) => (
                  <option key={`${p.year}|${p.type}`} value={`${p.year}|${p.type}`}>
                    {p.year} · {termTypeLabel(p.type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              الكلية
              <select
                value={search.college ?? ""}
                onChange={(e) => update({ college: e.target.value || undefined })}
              >
                <option value="">كل الكليات المتاحة</option>
                {rows.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              مصدر الجداول
              <select
                value={mode}
                onChange={(e) => update({ source: e.target.value as OverviewSourceMode })}
              >
                <option value="presentation">المنشور + أحدث مسودة مكتملة للحاسوب</option>
                <option value="published">المنشور فقط</option>
              </select>
            </label>
            <label>
              بحث عن كلية أو قسم
              <span className="uo-search">
                <Search size={16} />
                <Input
                  value={textSearch}
                  onChange={(e) => {
                    setTextSearch(e.target.value);
                    setSlide(0);
                  }}
                  placeholder="اسم الكلية أو القسم"
                />
              </span>
            </label>
            <div className="uo-control-actions">
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => {
                  void query.refetch();
                }}
              >
                <RefreshCw size={16} className={query.isFetching ? "animate-spin" : ""} />
                تحديث
              </Button>
              <Button
                disabled={!selected.length || !!report.error}
                onClick={() => {
                  setPresentation(true);
                  setSlide(0);
                }}
              >
                <Maximize2 size={16} />
                وضع العرض
              </Button>
            </div>
          </div>
        }
      >
        {data && (
          <p className="uo-snapshot">
            {periodLabel} <span>·</span> تحديث{" "}
            {new Date(data.generated_at).toLocaleString("ar-YE", {
              timeZone: "Asia/Riyadh",
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {query.isError && (
              <span className="uo-row-note"> · تعذر التحديث؛ تُعرض آخر قراءة ناجحة</span>
            )}
          </p>
        )}
        <div className={showCollege ? "uo-slide-hidden" : ""}>
          <UniversitySummary
            rows={selected}
            uniqueFaculty={allScope ? data?.unique_faculty : undefined}
            onSelect={selectCollege}
          />
        </div>
        {!presentation && selected.length > 1 && (
          <nav className="uo-college-nav report-no-print" aria-label="الانتقال إلى الكليات">
            {selected.map((c) => (
              <a href={`#college-${c.id}`} key={c.id}>
                {c.name}
              </a>
            ))}
          </nav>
        )}
        <div className="uo-colleges">
          {selected.map((c) => (
            <div
              key={c.id}
              className={presentation && showCollege?.id !== c.id ? "uo-slide-hidden" : ""}
            >
              <CollegeOverviewCard
                college={c}
                expanded={!!showCollege || !!search.college || !!needle}
              />
            </div>
          ))}
        </div>
        <p className="uo-report-foot">
          المؤشرات تُحسب من بيانات المنصة داخل صلاحيات الحساب. هذه الصفحة للعرض والتحليل ولا تغيّر
          الجداول أو الإسنادات. التفاصيل المطبوعة تشمل جداول الأقسام والموارد لكل كلية معروضة.
        </p>
      </ReportShell>
    </div>
  );
}
