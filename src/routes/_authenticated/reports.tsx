import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  UserSquare2,
  DoorOpen,
  Building2,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Gauge,
  FileBarChart2,
  Users2,
  LayoutGrid,
  ShieldAlert,
  ClipboardCheck,
  Archive,
  Stamp,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "التقارير" }] }),
  component: ReportsHub,
});

interface ReportCard {
  to: string;
  title: string;
  desc: string;
  icon: ReactNode;
  badge?: "official" | "legacy";
}

const TIMETABLE_REPORTS: ReportCard[] = [
  { to: "/reports/instructor-schedule", title: "جدول المحاضر الفردي", desc: "عرض Grid + جدول · نسخة واحدة · قابل للطباعة.", icon: <CalendarClock className="h-5 w-5" /> },
  { to: "/reports/section-timetable", title: "جدول المجموعة", desc: "عرض Grid + جدول · نسخة واحدة.", icon: <Users2 className="h-5 w-5" /> },
  { to: "/reports/room-timetable", title: "جدول القاعة", desc: "عرض Grid + جدول · نسخة واحدة.", icon: <DoorOpen className="h-5 w-5" /> },
  { to: "/reports/program-level-timetable", title: "جدول البرنامج/المستوى", desc: "فلاتر قسم/برنامج/مستوى · البديل الموصى به لجدول الأقسام.", icon: <LayoutGrid className="h-5 w-5" /> },
];

const ANALYTICS_REPORTS: ReportCard[] = [
  { to: "/reports/instructor-workload", title: "أعباء المحاضرين", desc: "تحميل تدريسي أسبوعي · نسخة واحدة · بدون double-count.", icon: <UserSquare2 className="h-5 w-5" /> },
  { to: "/reports/room-utilization", title: "استخدام القاعات", desc: "نسبة استغلال القاعات · نسخة واحدة.", icon: <DoorOpen className="h-5 w-5" /> },
];

const OPERATIONAL_REPORTS: ReportCard[] = [
  { to: "/reports/conflicts", title: "تعارضات الجدول", desc: "قراءة conflict_results · لا يشغّل Conflict Engine.", icon: <ShieldAlert className="h-5 w-5" /> },
  { to: "/reports/data-readiness", title: "جاهزية البيانات", desc: "فحوص الجاهزية · قابل للتصدير · على مستوى الكلية.", icon: <ClipboardCheck className="h-5 w-5" /> },
  { to: "/reports/unscheduled", title: "الجلسات غير المجدوَلة", desc: "الناقص vs المطلوب · أسباب من آخر auto_schedule_run.", icon: <AlertTriangle className="h-5 w-5" /> },
  { to: "/reports/quality-summary", title: "ملخص الجودة", desc: "آخر quality run · نسخة واحدة · لا يشغّل Quality Engine.", icon: <Gauge className="h-5 w-5" /> },
];

const OFFICIAL_REPORTS: ReportCard[] = [
  {
    to: "/reports/published-timetable",
    title: "الجدول المنشور",
    desc: "تقرير رسمي شامل · published_only · للعرض الإداري والطباعة.",
    icon: <CheckCircle2 className="h-5 w-5" />,
    badge: "official",
  },
];

const LEGACY_REPORTS: ReportCard[] = [
  {
    to: "/reports/department-schedule",
    title: "جدول الأقسام",
    desc: "Legacy — لم يُرحّل. استخدم جدول البرنامج/المستوى بدلاً منه.",
    icon: <Building2 className="h-5 w-5" />,
    badge: "legacy",
  },
];

const SECTIONS: {
  id: string;
  title: string;
  description: string;
  items: ReportCard[];
  accent?: string;
}[] = [
  {
    id: "timetable",
    title: "Timetable Reports — تقارير الجداول الزمنية",
    description: "جداول أسبوعية (Grid + Table) لمحاضر/مجموعة/قاعة/برنامج — نسخة جدول واحدة.",
    items: TIMETABLE_REPORTS,
  },
  {
    id: "analytics",
    title: "Analytics Reports — تقارير تحليلية",
    description: "مؤشرات تحميل واستغلال — للمراجعة الإدارية دون تجميع عبر نسخ متعددة.",
    items: ANALYTICS_REPORTS,
  },
  {
    id: "operational",
    title: "Operational Reports — تقارير تشغيلية",
    description: "تعارضات، جاهزية، نواقص الجدولة، وجودة — للقراءة فقط من بيانات محفوظة.",
    items: OPERATIONAL_REPORTS,
  },
  {
    id: "official",
    title: "Official / Published Reports — تقارير رسمية",
    description: "تقارير منشورة للعرض الرسمي والطباعة أثناء Pilot — لا draft/review.",
    items: OFFICIAL_REPORTS,
    accent: "border-primary/30 bg-primary/5",
  },
  {
    id: "legacy",
    title: "Legacy — تقارير قديمة",
    description: "مسارات محفوظة للتوافق — يُفضّل البدائل الحديثة في الأقسام أعلاه.",
    items: LEGACY_REPORTS,
    accent: "border-amber-500/30 bg-amber-500/5",
  },
];

function ReportGrid({ items }: { items: ReportCard[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((r) => (
        <Link key={r.to} to={r.to} className="block">
          <Card className="p-4 hover:shadow-md transition-shadow cursor-pointer h-full">
            <div className="flex items-start gap-3">
              <div className="rounded-md bg-primary/10 text-primary p-2">{r.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{r.title}</span>
                  {r.badge === "official" && (
                    <Badge variant="default" className="text-[10px] gap-1">
                      <Stamp className="h-3 w-3" /> رسمي
                    </Badge>
                  )}
                  {r.badge === "legacy" && (
                    <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/50 text-amber-700">
                      <Archive className="h-3 w-3" /> Legacy
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{r.desc}</div>
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function ReportsHub() {
  return (
    <div className="space-y-8" dir="rtl">
      <header className="usr-page-header">
        <span className="usr-page-header-icon"><FileBarChart2 className="h-5 w-5" /></span>
        <div>
          <h1 className="text-2xl font-bold">التقارير</h1>
          <p className="text-sm text-muted-foreground mt-1">
            تقارير أكاديمية للقراءة فقط · رأس رسمي · طباعة · تصدير CSV و Excel.
          </p>
        </div>
      </header>

      {SECTIONS.map((section) => (
        <section
          key={section.id}
          className={`space-y-3 rounded-lg border p-4 ${section.accent ?? "border-border/60"}`}
        >
          <div>
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{section.description}</p>
          </div>
          <ReportGrid items={section.items} />
        </section>
      ))}
    </div>
  );
}
