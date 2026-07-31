import { createFileRoute, Link } from "@tanstack/react-router";
import { ReportShell } from "@/components/reports/report-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/reports/advanced-academic")({
  head: () => ({ meta: [{ title: "التقارير الإدارية المتقدمة" }] }),
  component: AdvancedAcademicReportsPage,
});

const CATALOG = [
  {
    key: "instructor_load",
    title: "نصاب كل مدرس",
    to: "/reports/instructor-workload",
    supports: "فلاتر · Excel/CSV · RTL",
  },
  {
    key: "hours_gap",
    title: "الساعات الزائدة/الناقصة (عبر أعباء المحاضرين)",
    to: "/reports/instructor-workload",
    supports: "فلاتر · Excel/CSV · RTL",
  },
  {
    key: "room_util",
    title: "القاعات ونسب الاستخدام",
    to: "/reports/room-utilization",
    supports: "فلاتر · Excel/CSV · RTL",
  },
  {
    key: "labs",
    title: "المعامل المتخصصة (جدول القاعة + نوع)",
    to: "/reports/room-timetable",
    supports: "فلاتر · Print · RTL",
  },
  {
    key: "regular_parallel",
    title: "مقارنة المنتظم والموازي",
    to: "/reports/program-level-timetable",
    supports: "فلتر النظام · Print · RTL",
  },
  {
    key: "cohort_gaps",
    title: "فجوات الدفعات (تحليل الجودة)",
    to: "/reports/quality-analytics",
    supports: "قراءة فقط · Print/Excel",
  },
  {
    key: "instructor_gaps",
    title: "فجوات المدرسين (تحليل الجودة)",
    to: "/reports/quality-analytics",
    supports: "قراءة فقط · Print/Excel",
  },
  {
    key: "pressure_days",
    title: "الأيام شديدة الضغط (توزيع الأيام في الجودة)",
    to: "/reports/quality-analytics",
    supports: "قراءة فقط",
  },
  {
    key: "version_diff",
    title: "التغييرات بين نسختين",
    to: "/reports",
    supports: "يتطلب دمج PR #131 (version-comparison) · قراءة فقط",
    pending: true,
  },
  {
    key: "dept",
    title: "ملخص القسم / البرنامج",
    to: "/reports/program-level-timetable",
    supports: "فلاتر · Print · RTL",
  },
  {
    key: "daily_weekly",
    title: "تقرير يومي/أسبوعي (جدول منشور)",
    to: "/reports/published-timetable",
    supports: "published_only · Print",
  },
  {
    key: "unassigned",
    title: "مقررات بلا مدرس / غير مجدول",
    to: "/reports/unscheduled",
    supports: "قراءة فقط · Excel/CSV",
  },
] as const;

function AdvancedAcademicReportsPage() {
  const rows = CATALOG.map((c) => ({
    title: c.title,
    path: c.to,
    supports: c.supports,
    status: "pending" in c && c.pending ? "depends_on_open_pr" : "available",
  }));
  const headers = [
    { key: "title", label: "التقرير" },
    { key: "path", label: "المسار" },
    { key: "supports", label: "الدعم" },
    { key: "status", label: "الحالة" },
  ];

  return (
    <div dir="rtl">
      <ReportShell
        title="التقارير الإدارية المتقدمة"
        description="فهرس قراءة فقط للتقارير الحالية — بلا مصدر بيانات جديد وبلا Migration."
        filename="advanced_academic_reports_catalog"
        rows={rows}
        headers={headers}
      >
        <Card className="p-3 text-sm text-muted-foreground mb-4">
          Demo/Operational: استخدم فلاتر التقارير الرسمية المنشورة؛ تحذير Demo يظهر على النسخ
          التجريبية. نطاق الكلية من السياق النشط. لا تُضاف materialized views في هذه الحزمة.
        </Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {CATALOG.map((c) => (
            <Card key={c.key} className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{c.title}</div>
                {"pending" in c && c.pending ? (
                  <Badge variant="outline">بانتظار PR</Badge>
                ) : (
                  <Badge>متاح</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{c.supports}</div>
              <Link className="text-sm underline" to={c.to}>
                فتح التقرير
              </Link>
            </Card>
          ))}
        </div>
      </ReportShell>
    </div>
  );
}
