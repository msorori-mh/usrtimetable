import { canManageTeachingPay } from "@/lib/viewer-roles";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  canViewLeadership,
  executiveDashboardTitle,
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
  ArrowUpLeft,
  Search,
  X,
  Wallet,
  Layers,
  Printer,
} from "lucide-react";

const HUB_TITLE = "مركز التقارير — جامعة إقليم سبأ";
const HUB_DESCRIPTION =
  "تقارير الجامعة في مكان واحد: الجداول والإسناد والقاعات والمؤشرات والأجور، مع بحث سريع وطباعة وتصدير.";

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
  access?: "leadership" | "payroll";
  to: string;
  search?: {
    report:
      | "coverage"
      | "teaching_pay"
      | "overload_system"
      | "contractual"
      | "overload"
      | "deficit"
      | "course_status";
  };
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
    desc: "ملخص القاعات والمعامل يفصل المجدول عن الإشغال داخل الإتاحة والساعات خارجها، ثم جدول تفصيلي لكل مورد.",
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

const COURSE_ASSIGNMENT_STATUS_REPORT: ReportCard = {
  to: "/reports/academic-affairs",
  search: { report: "course_status" },
  title: "حالة إسناد المقررات",
  desc: "كل مقرر ومجموعة تدريس مع حالة الإسناد والمحاضرين والساعات المطلوبة والمسندة والمتبقية، مع الطباعة والتصدير.",
  icon: <ClipboardCheck className="h-5 w-5" />,
};

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
  reports: [
    ...ANALYTICS_REPORTS.slice(1, 5),
    {
      to: "/reports/academic-affairs",
      search: { report: "overload_system" },
      title: "الساعات الزائدة بحسب النظام",
      desc: "الزيادة في العام والموازي بعد استيفاء النصاب مرة واحدة، مع الطباعة والتصدير.",
      icon: <FileBarChart2 className="h-5 w-5" />,
    },
    {
      to: "/reports/academic-affairs",
      search: { report: "coverage" },
      title: "مصادر تغطية الساعات التدريسية",
      desc: "من داخل الكلية، ومن كليات أخرى، وبتعاقد خارجي، بحسب القسم والبرنامج والنظام.",
      icon: <FileBarChart2 className="h-5 w-5" />,
    },
    {
      to: "/reports/academic-affairs",
      search: { report: "contractual" },
      title: "الساعات التعاقدية بحسب النظام",
      desc: "ساعات المتعاقدين في الكلية موزعة على العام والموازي، مع الطباعة والتصدير.",
      icon: <FileBarChart2 className="h-5 w-5" />,
    },
  ],
};
const DEMAND_CAPACITY_REPORT: ReportCard = {
  to: "/reports/teaching-demand-capacity",
  title: "الساعات المطلوبة وسعة القاعات",
  desc: "تفصيل البرنامج والمستوى للإدمن، وملخص الجامعة لرئيس الجامعة، وملخص الكلية للعميد؛ مع بيان اكتمال المصدر.",
  icon: <FileBarChart2 className="h-5 w-5" />,
};
const QUALITY_REPORTS: ReportCard = {
  to: "/reports/quality-summary",
  title: "جودة الجدول",
  desc: "ملخص التقييم وتحليل التعارضات والفجوات والأحمال والقاعات.",
  icon: <Gauge className="h-5 w-5" />,
  reports: OPERATIONAL_REPORTS.slice(3),
};

interface ReportCategory {
  id: string;
  title: string;
  description: string;
  icon: ReactNode;
  items: ReportCard[];
}

const SECTIONS: ReportCategory[] = [
  {
    id: "timetable",
    title: "الجداول الدراسية",
    description: "جداول الكلية والمحاضرين والبرامج والمستويات.",
    icon: <CalendarClock className="h-4 w-4" />,
    items: [TIMETABLE_REPORTS[2], ...STUDENT_REPORTS.reports!],
  },
  {
    id: "faculty",
    title: "المحاضرون والإسناد",
    description: "الكادر الأكاديمي، إسناد المقررات، النصاب والساعات بحسب النظام.",
    icon: <UserSquare2 className="h-4 w-4" />,
    items: [
      ANALYTICS_REPORTS[0],
      COURSE_ASSIGNMENT_STATUS_REPORT,
      ...TEACHING_LOAD_REPORTS.reports!,
    ],
  },
  {
    id: "rooms",
    title: "القاعات والمعامل",
    description: "القاعات والمعامل: الجداول والسعة والاستخدام والاحتياج.",
    icon: <DoorOpen className="h-4 w-4" />,
    items: [...ROOM_REPORTS.reports!, { ...DEMAND_CAPACITY_REPORT, access: "leadership" }],
  },
  {
    id: "quality",
    title: "الجودة والجاهزية",
    description: "راجع النواقص والتعارضات ومؤشرات جودة الجدول.",
    icon: <ClipboardCheck className="h-4 w-4" />,
    items: [...OPERATIONAL_REPORTS.slice(0, 3), ...QUALITY_REPORTS.reports!],
  },
  {
    id: "leadership",
    title: "التقارير التنفيذية",
    description: "صورة شاملة للجامعة والكليات لدعم المراجعة واتخاذ القرار.",
    icon: <Gauge className="h-4 w-4" />,
    items: [
      {
        to: "/reports/university-overview",
        title: "التقرير التنفيذي الشامل",
        desc: "الأقسام والاحتياج التدريسي والقاعات والمعامل والكادر في عرض موحد للاجتماعات.",
        icon: <Building2 className="h-5 w-5" />,
        access: "leadership",
      },
      {
        to: "/reports/leadership",
        title: "المؤشرات التنفيذية للجامعة",
        desc: "الإسناد والنصاب والزيادة والعجز والساعات التدريسية ومؤشرات الموارد.",
        icon: <Gauge className="h-5 w-5" />,
        access: "leadership",
      },
    ],
  },
  {
    id: "pay",
    title: "الأجور والمستحقات",
    description: "الأسعار والتنفيذ المعتمد وكشوف المستحقات المالية.",
    icon: <Wallet className="h-4 w-4" />,
    items: [
      {
        to: "/reports/academic-affairs",
        search: { report: "teaching_pay" },
        title: "أجور التدريس الفعلي وكشوف الصرف",
        desc: "أسعار الرتب العلمية، الساعات المنفذة المعتمدة، وكشوف الزائد والتعاقدي للأمين العام.",
        icon: <Wallet className="h-5 w-5" />,
        access: "payroll",
      },
    ],
  },
];

const LEGACY_SECTION: ReportCategory = {
  id: "legacy",
  title: "أرشيف التقارير التاريخية",
  description: "للعرض التاريخي فقط؛ استخدم الجداول الدراسية للتقارير الحالية.",
  icon: <Archive className="h-4 w-4" />,
  items: LEGACY_REPORTS,
};
const QUICK_REPORTS = [
  TIMETABLE_REPORTS[2],
  TIMETABLE_REPORTS[4],
  TIMETABLE_REPORTS[0],
  COURSE_ASSIGNMENT_STATUS_REPORT,
  TEACHING_LOAD_REPORTS.reports![4],
  TIMETABLE_REPORTS[1],
];
const reportKey = (report: ReportCard) => `${report.to}:${report.search?.report ?? "all"}`;

function ReportList({ items }: { items: (ReportCard & { category?: string })[] }) {
  return (
    <ul className="grid gap-x-5 sm:grid-cols-2" aria-label="قائمة التقارير">
      {items.map((report) => (
        <li key={reportKey(report)} className="min-w-0 border-b border-border/60 last:border-b-0">
          <Link
            to={report.to}
            search={report.search}
            aria-label={report.linkLabel ?? report.title}
            data-report-hub-link={
              report.to === "/reports/data-readiness" ? "data-readiness-report" : undefined
            }
            className="group flex h-full min-h-20 items-start gap-3 rounded-md px-2 py-3 transition-colors hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span
              aria-hidden
              className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/5 text-primary"
            >
              {report.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-6 text-foreground group-hover:text-primary">
                {report.title}
                {report.badge === "official" && (
                  <Stamp aria-label="رسمي" className="h-3.5 w-3.5 text-primary" />
                )}
                {report.badge === "legacy" && (
                  <Badge variant="outline" className="text-[10px]">
                    أرشيف
                  </Badge>
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                {report.desc}
              </span>
              {report.category && (
                <span className="mt-1 block text-[11px] text-primary">{report.category}</span>
              )}
            </span>
            <ArrowUpLeft
              aria-hidden
              className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ReportsHub() {
  const [selected, setSelected] = useState("quick");
  const [legacyOpen, setLegacyOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: me, isLoading, error, refetch } = useCurrentUser();
  const needle = normalizeSearchText(search);
  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((report) =>
        report.access === "payroll"
          ? canManageTeachingPay(me)
          : report.access === "leadership"
            ? canViewLeadership(me)
            : true,
      )
      .map((report) =>
        report.to === "/reports/leadership"
          ? { ...report, title: executiveDashboardTitle(me) }
          : report,
      ),
  })).filter((section) => section.items.length);
  const categories: ReportCategory[] = [
    {
      id: "quick",
      title: "وصول سريع",
      description: "ابدأ مباشرة بالتقرير المطلوب، أو اختر تصنيفًا لاستعراض بقية التقارير.",
      icon: <Layers className="h-4 w-4" />,
      items: QUICK_REPORTS,
    },
    ...visibleSections,
  ];
  const active =
    (legacyOpen ? LEGACY_SECTION : categories.find((category) => category.id === selected)) ??
    categories[0];
  const allReports = [...visibleSections, LEGACY_SECTION].flatMap((category) =>
    category.items.map((report) => ({ ...report, category: category.title })),
  );
  const results = needle
    ? allReports.filter((report) =>
        normalizeSearchText(`${report.title} ${report.desc} ${report.category}`).includes(needle),
      )
    : active.items;
  const restrictedViewer =
    isReportsOnlyRole(me) || isAcademicAffairsRole(me) || isLeadershipOnlyRole(me);
  const choose = (id: string) => {
    setSelected(id);
    setLegacyOpen(id === "legacy");
    setSearch("");
  };
  if (isLoading)
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        جارٍ تحميل التقارير المتاحة…
      </p>
    );
  if (error || !me)
    return (
      <div role="alert" className="rounded-lg border p-4">
        <p>تعذر تحميل التقارير المتاحة لحسابك.</p>
        <button
          type="button"
          className="mt-2 text-sm font-semibold text-primary"
          onClick={() => void refetch()}
        >
          إعادة المحاولة
        </button>
      </div>
    );
  return (
    <div className="min-w-0 space-y-4" dir="rtl" data-testid="reports-compact-hub">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-primary">
            <FileBarChart2 aria-hidden className="h-5 w-5" />
            التقارير والطباعة
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {allReports.length} تقريرًا متاحًا · اختر التصنيف أو ابحث باسم التقرير
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-primary">
          {canViewLeadership(me) && (
            <Link
              to="/reports/university-overview"
              className="rounded px-2 py-1.5 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              التقرير التنفيذي الشامل ↖
            </Link>
          )}
          {!restrictedViewer && (
            <Link
              to="/published-schedules"
              className="rounded px-2 py-1.5 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              الجداول الرسمية والنشر ↖
            </Link>
          )}
        </div>
      </header>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ابحث في جميع التقارير: محاضر، ساعات، قاعات…"
          aria-label="ابحث عن تقرير"
          className="h-10 ps-10 pe-12"
        />
        {search && (
          <button
            type="button"
            aria-label="مسح البحث"
            onClick={() => setSearch("")}
            className="absolute end-1 top-1 rounded p-2 text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <X aria-hidden className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
        <nav aria-label="تصنيفات التقارير" className="min-w-0">
          <label className="grid gap-2 text-sm lg:hidden">
            تصنيف التقارير
            <select
              value={legacyOpen ? "legacy" : active.id}
              onChange={(event) => choose(event.target.value)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.title} ({category.items.length})
                </option>
              ))}
              <option value="legacy">
                {LEGACY_SECTION.title} ({LEGACY_REPORTS.length})
              </option>
            </select>
          </label>
          <div className="hidden space-y-1 rounded-xl border bg-muted/20 p-2 lg:block">
            {categories.map((category) => (
              <button
                type="button"
                key={category.id}
                onClick={() => choose(category.id)}
                aria-pressed={!needle && !legacyOpen && active.id === category.id}
                aria-controls="reports-results"
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${!needle && !legacyOpen && active.id === category.id ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-primary/5 hover:text-primary"}`}
              >
                <span aria-hidden>{category.icon}</span>
                <span className="flex-1">{category.title}</span>
                <span className="text-xs tabular-nums opacity-80">{category.items.length}</span>
              </button>
            ))}
            <div className="border-t pt-2" data-testid="reports-legacy-section">
              <button
                type="button"
                onClick={() => choose(legacyOpen ? "quick" : "legacy")}
                aria-expanded={legacyOpen}
                aria-controls="reports-results"
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-start text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${legacyOpen && !needle ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:bg-primary/5"}`}
              >
                <Archive aria-hidden className="h-4 w-4" />
                <span className="flex-1">{LEGACY_SECTION.title}</span>
                <span>{LEGACY_REPORTS.length}</span>
              </button>
            </div>
          </div>
        </nav>
        <section
          id="reports-results"
          aria-labelledby="reports-results-title"
          className="min-w-0 rounded-xl border bg-card px-4 py-3"
        >
          <div className="mb-1 border-b pb-3">
            <div className="flex items-center justify-between gap-3">
              <h2 id="reports-results-title" className="text-base font-semibold">
                {needle ? "نتائج البحث في جميع التقارير" : active.title}
              </h2>
              <span
                className="shrink-0 text-xs text-muted-foreground"
                role="status"
                aria-live="polite"
              >
                {results.length} تقارير
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {needle ? `نتائج البحث عن «${search.trim()}»` : active.description}
            </p>
          </div>
          {results.length ? (
            <ReportList items={results} />
          ) : (
            <div className="py-10 text-center">
              <Search aria-hidden className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
              <p className="text-sm">لا يوجد تقرير مطابق لبحثك.</p>
              <button
                type="button"
                onClick={() => setSearch("")}
                className="mt-3 text-sm font-semibold text-primary"
              >
                مسح البحث والعودة للتقارير
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
