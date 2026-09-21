import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  canViewLeadership,
  isLeadershipOnlyRole,
  isAcademicAffairsRole,
  isReportsOnlyRole,
} from "@/lib/viewer-roles";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { normalizeSearchText } from "@/lib/reports/search";
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
  ChevronDown,
  Printer,
} from "lucide-react";

const HUB_TITLE = "مركز التقارير — جامعة إقليم سبأ";
const HUB_DESCRIPTION =
  "مركز تقارير الجداول الأكاديمية: جداول المحاضرين والقاعات والبرامج، تحليلات الأعباء والاستخدام، الجاهزية والتعارضات والجودة — قراءة فقط مع رأس رسمي وطباعة وتصدير.";

export const Route = createFileRoute("/_authenticated/reports/")({
  head: () => ({
    meta: [
      { title: HUB_TITLE },
      { name: "description", content: HUB_DESCRIPTION },
      { property: "og:title", content: HUB_TITLE },
      { property: "og:description", content: HUB_DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportsHub,
});

interface ReportCard {
  reports?: ReportCard[];
  to: string;
  search?: { report: "overload" | "deficit" };
  title: string;
  desc: string;
  icon: ReactNode;
  badge?: "official" | "legacy";
  /** Distinct accessible name when sidebar shares similar label (e.g. /data-readiness vs report). */
  linkLabel?: string;
}

const TIMETABLE_REPORTS: ReportCard[] = [
  {
    to: "/reports/current-timetable",
    title: "طباعة الجدول الحالي",
    desc: "النسخة الحالية كاملة · مجمعة حسب البرنامج/المستوى/النظام ومجموعات الطلاب · رأس رسمي · A4 عمودي.",
    icon: <Printer className="h-5 w-5" />,
    badge: "official",
  },
  {
    to: "/reports/rooms-report",
    title: "تقرير القاعات",
    desc: "ملخص كل القاعات والمعامل (النوع، السعة، الساعات المستخدمة/المتاحة، الاستغلال) ثم جدول تفصيلي لكل قاعة.",
    icon: <DoorOpen className="h-5 w-5" />,
    badge: "official",
  },
  {
    to: "/reports/instructor-schedule",
    title: "جدول المحاضر الفردي",
    desc: "مواعيد المحاضر وقاعاته ومجموعاته، بعرض أسبوعي أو يومي أو قائمة.",
    icon: <CalendarClock className="h-5 w-5" />,
  },
  {
    to: "/reports/room-timetable",
    title: "جدول القاعة",
    desc: "مواعيد إشغال القاعة أو المعمل في الأسبوع.",
    icon: <DoorOpen className="h-5 w-5" />,
  },
  {
    to: "/reports/program-level-timetable",
    title: "جدول البرنامج/المستوى",
    desc: "فلاتر قسم/برنامج/مستوى/دفعة دراسية/مجموعة محاضرات ومعامل · البديل الموصى به لجدول الأقسام.",
    icon: <LayoutGrid className="h-5 w-5" />,
  },
];

const ANALYTICS_REPORTS: ReportCard[] = [
  {
    to: "/reports/instructors",
    title: "دليل المحاضرين وبياناتهم",
    desc: "بيانات المحاضرين الأساسية، التبعية الأكاديمية، الرتبة، النصاب، الإعفاء الإداري، وسائل التواصل والحالة.",
    icon: <UserSquare2 className="h-5 w-5" />,
    badge: "official",
  },
  {
    to: "/reports/academic-affairs",
    title: "تقارير الشؤون الأكاديمية",
    desc: "الإسناد وعجز التغطية والنصاب والساعات الزائدة والنقص، بحسب الكلية والقسم والبرنامج وعضو هيئة التدريس.",
    icon: <FileBarChart2 className="h-5 w-5" />,
  },
  {
    to: "/reports/academic-affairs",
    search: { report: "overload" },
    title: "تقرير الساعات الزائدة",
    desc: "كشف مستقل بأعضاء هيئة التدريس الذين تجاوزوا صافي النصاب، مع مجموع الساعات الزائدة والطباعة والتصدير.",
    icon: <FileBarChart2 className="h-5 w-5" />,
  },
  {
    to: "/reports/academic-affairs",
    search: { report: "deficit" },
    title: "تقرير عجز النصاب",
    desc: "كشف مستقل بنقص نصاب أعضاء هيئة التدريس والساعات المتاحة لاستكماله، مع الطباعة والتصدير.",
    icon: <UserSquare2 className="h-5 w-5" />,
  },
  {
    to: "/reports/instructor-workload",
    title: "العبء المجدول للمحاضرين",
    desc: "الساعات المجدولة فعليًا ومقارنتها بالحد الأسبوعي؛ يختلف عن تقرير النصاب والإسناد.",
    icon: <UserSquare2 className="h-5 w-5" />,
  },
  {
    to: "/reports/room-utilization",
    title: "استخدام القاعات",
    desc: "نسبة استغلال القاعات · نسخة واحدة.",
    icon: <DoorOpen className="h-5 w-5" />,
  },
];

const OPERATIONAL_REPORTS: ReportCard[] = [
  {
    to: "/reports/conflicts",
    title: "تعارضات الجدول",
    desc: "أطراف التعارض ووقته ونتيجة آخر فحص محفوظ.",
    icon: <ShieldAlert className="h-5 w-5" />,
  },
  {
    to: "/reports/data-readiness",
    title: "تقرير جاهزية البيانات",
    linkLabel: "تقرير جاهزية البيانات — التقارير",
    desc: "ما ينقص بيانات الكلية والإجراءات اللازمة لاستكمالها.",
    icon: <ClipboardCheck className="h-5 w-5" />,
  },
  {
    to: "/reports/unscheduled",
    title: "المحاضرات غير المجدوَلة",
    desc: "المجموعات التي لم تُسكن أو لم تكتمل ساعاتها في النسخة المختارة.",
    icon: <AlertTriangle className="h-5 w-5" />,
  },
  {
    to: "/reports/quality-summary",
    title: "ملخص الجودة",
    desc: "آخر تقييم محفوظ لكل نسخة، مع تاريخ التقييم ومؤشراته.",
    icon: <Gauge className="h-5 w-5" />,
  },
  {
    to: "/reports/quality-analytics",
    title: "مركز تحليل جودة الجدول",
    desc: "درجة تفسيرية · تعارضات/فجوات/حمل/قاعات · قراءة فقط دون تشغيل المجدول.",
    icon: <FileBarChart2 className="h-5 w-5" />,
  },
];

const OFFICIAL_REPORTS: ReportCard[] = [
  {
    to: "/reports/published-timetable",
    title: "الجدول المنشور",
    desc: "نسخة منشورة محددة للعرض الرسمي والطباعة.",
    icon: <CheckCircle2 className="h-5 w-5" />,
    badge: "official",
  },
];

const LEGACY_REPORTS: ReportCard[] = [
  {
    to: "/reports/section-timetable",
    title: "جدول المجموعة",
    desc: "للسجلات التاريخية فقط. استخدم جدول البرنامج/المستوى للجداول الحالية.",
    icon: <Users2 className="h-5 w-5" />,
    badge: "legacy",
  },
  {
    to: "/reports/department-schedule",
    title: "جدول الأقسام",
    desc: "للسجلات التاريخية فقط. جدول البرنامج/المستوى هو مدخل الجداول الحالية.",
    icon: <Building2 className="h-5 w-5" />,
    badge: "legacy",
  },
];


/** One entry per task; detailed reports retain their routes and permissions. */
const STUDENT_REPORTS: ReportCard = {
  to: "/reports/current-timetable",
  title: "جداول الطلاب",
  desc: "عرض وطباعة جدول الكلية كاملة أو القسم أو البرنامج أو المستوى.",
  icon: <LayoutGrid className="h-5 w-5" />,
  reports: [TIMETABLE_REPORTS[0], TIMETABLE_REPORTS[4], OFFICIAL_REPORTS[0]],
};
const ROOM_REPORTS: ReportCard = {
  to: "/reports/rooms-report",
  title: "القاعات والمعامل",
  desc: "جداول القاعات والمعامل، السعة والاستغلال وأوقات الإتاحة.",
  icon: <DoorOpen className="h-5 w-5" />,
  reports: [TIMETABLE_REPORTS[1], TIMETABLE_REPORTS[3], ANALYTICS_REPORTS[5]],
};
const TEACHING_LOAD_REPORTS: ReportCard = {
  to: "/reports/academic-affairs",
  title: "النصاب التدريسي",
  desc: "الإسناد والنصاب والساعات الزائدة والعجز، مع تقرير مستقل للساعات المجدولة فعليًا.",
  icon: <FileBarChart2 className="h-5 w-5" />,
  reports: ANALYTICS_REPORTS.slice(1, 5),
};
const QUALITY_REPORTS: ReportCard = {
  to: "/reports/quality-summary",
  title: "جودة الجدول",
  desc: "ملخص التقييم وتحليل التعارضات والفجوات والأحمال والقاعات.",
  icon: <Gauge className="h-5 w-5" />,
  reports: OPERATIONAL_REPORTS.slice(3),
};

const SECTIONS: {
  id: string;
  title: string;
  description: string;
  items: ReportCard[];
  accent?: string;
}[] = [
  {
    id: "timetable",
    title: "أريد عرض جدول",
    description: "اختر جدول المحاضر أو القاعة أو مجموعة الطلاب.",
    items: [STUDENT_REPORTS, TIMETABLE_REPORTS[2], ROOM_REPORTS],
  },
  {
    id: "analytics",
    title: "أريد مراجعة الإسناد والأعباء والموارد",
    description: "مؤشرات تحميل واستغلال — للمراجعة الإدارية دون تجميع عبر نسخ متعددة.",
    items: [ANALYTICS_REPORTS[0], TEACHING_LOAD_REPORTS],
  },
  {
    id: "operational",
    title: "أريد معرفة النواقص والمشكلات",
    description: "تعارضات، جاهزية، نواقص الجدولة، وجودة — للقراءة فقط من بيانات محفوظة.",
    items: [...OPERATIONAL_REPORTS.slice(0, 3), QUALITY_REPORTS],
  },
];

const LEGACY_SECTION = {
  id: "legacy",
  title: "أرشيف التقارير التاريخية",
  description:
    "تحذير: مسارات محفوظة للتوافق — للعرض التاريخي فقط · يُفضّل البدائل الحديثة في الأقسام أعلاه.",
  items: LEGACY_REPORTS,
  accent: "border-amber-500/30 bg-amber-500/5",
};

function ReportGrid({ items, expandMatches = false }: { items: ReportCard[]; expandMatches?: boolean }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((r) => r.reports ? (
        <Card key={r.to} className="h-full">
          <details key={expandMatches ? "search" : "browse"} open={expandMatches || undefined} className="group">
            <summary className="flex cursor-pointer list-none items-start gap-3 rounded-lg p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              <span className="rounded-md bg-primary/10 p-2 text-primary">{r.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{r.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{r.desc}</span>
                <span className="mt-2 block text-xs text-primary">عرض التقارير ({r.reports.length})</span>
              </span>
              <ChevronDown aria-hidden className="mt-2 h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
            </summary>
            <nav aria-label={r.title} className="space-y-1 border-t p-2">
              {r.reports.map((report) => (
                <Link
                  key={`${report.to}:${report.search?.report ?? "all"}`}
                  to={report.to}
                  search={report.search}
                  aria-label={report.linkLabel ?? report.title}
                  className="block rounded-md p-3 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="block text-sm font-semibold text-primary">{report.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{report.desc}</span>
                </Link>
              ))}
            </nav>
          </details>
        </Card>
      ) : (
        <Link
          key={`${r.to}:${r.search?.report ?? "all"}`}
          to={r.to}
          search={r.search}
          className="block"
          aria-label={r.linkLabel ?? r.title}
          data-report-hub-link={
            r.to === "/reports/data-readiness" ? "data-readiness-report" : undefined
          }
        >
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
                    <Badge
                      variant="outline"
                      className="text-[10px] gap-1 border-amber-500/50 text-amber-700"
                    >
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
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [search, setSearch] = useState("");
  const needle = normalizeSearchText(search);
  const match = (items: ReportCard[]) =>
    needle
      ? items.filter((r) => normalizeSearchText([r.title, r.desc, ...(r.reports ?? []).flatMap((report) => [report.title, report.desc])].join(" ")).includes(needle))
      : items;
  const visibleSections = SECTIONS.map((s) => ({ ...s, items: match(s.items) })).filter(
    (s) => s.items.length > 0,
  );
  const legacyItems = match(LEGACY_SECTION.items);
  // «مشاهد» stays inside /reports/*: the publishing area is out of scope.
  const { data: me } = useCurrentUser();
  const restrictedViewer =
    isReportsOnlyRole(me) || isAcademicAffairsRole(me) || isLeadershipOnlyRole(me);
  return (
    <div className="space-y-8" dir="rtl">
      <section
        className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6"
        aria-label="الترحيب بالمستخدم"
      >
        <p className="text-sm font-semibold text-primary">مركز التقارير</p>
        <h2 className="mt-2 text-xl font-bold sm:text-2xl">
          {me?.fullName?.trim() ? `مرحبًا، ${me.fullName.trim()}` : "مرحبًا بك"}
        </h2>
        <p className="mt-2 text-sm leading-7 text-muted-foreground">
          من هنا تبدأ قراءة الصورة الأكاديمية: اختر الكلية، ثم التقرير الذي يجيب عن سؤالك.
        </p>
      </section>
      {canViewLeadership(me) && (
        <Link
          to="/reports/leadership"
          className="block rounded-xl border-2 border-primary/30 bg-primary/5 p-5 text-primary"
        >
          <span className="text-lg font-bold">لوحة الإدارة العليا للجامعة</span>
          <p className="mt-2 text-sm">
            الإسناد والنصاب والزيادة والعجز والقاعات والساعات التدريسية لجميع الكليات في صفحة واحدة.
          </p>
        </Link>
      )}
      <header className="usr-page-header">
        <span className="usr-page-header-icon">
          <FileBarChart2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">التقارير والطباعة</h1>
          {!restrictedViewer && (
            <Link
              to="/published-schedules"
              className="mt-2 inline-block text-sm font-semibold text-primary hover:underline"
            >
              الجداول الرسمية والنشر ←
            </Link>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            تقارير أكاديمية للقراءة فقط · رأس رسمي · طباعة · تصدير CSV و Excel.
          </p>
        </div>
      </header>

      <div className="relative max-w-md">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث عن تقرير…"
          aria-label="ابحث عن تقرير"
        />
      </div>

      {visibleSections.length === 0 && legacyItems.length === 0 && (
        <p className="text-sm text-muted-foreground">لا يوجد تقرير مطابق لبحثك.</p>
      )}

      {visibleSections.map((section) => (
        <section
          key={section.id}
          className={`space-y-3 rounded-lg border p-4 ${section.accent ?? "border-border/60"}`}
        >
          <div>
            <h2 className="text-lg font-semibold">{section.title}</h2>
            <p className="text-sm text-muted-foreground mt-0.5">{section.description}</p>
          </div>
          <ReportGrid items={section.items} expandMatches={!!needle} />
        </section>
      ))}

      {legacyItems.length > 0 && (
        <section
          className={`space-y-3 rounded-lg border p-4 ${LEGACY_SECTION.accent}`}
          data-testid="reports-legacy-section"
        >
          <button
            type="button"
            onClick={() => setLegacyOpen((v) => !v)}
            aria-expanded={legacyOpen}
            className="flex w-full items-center justify-between gap-3 text-right"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-lg font-semibold">
                <Archive className="h-4 w-4 shrink-0" />
                {LEGACY_SECTION.title}
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                {LEGACY_SECTION.description}
              </span>
            </span>
            <ChevronDown
              className={`h-4 w-4 shrink-0 transition-transform ${legacyOpen ? "rotate-180" : ""}`}
            />
          </button>
          {(legacyOpen || !!needle) && <ReportGrid items={legacyItems} />}
        </section>
      )}
    </div>
  );
}
