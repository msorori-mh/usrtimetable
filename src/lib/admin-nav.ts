/**
 * Single source of truth for admin navigation + the /admin-tools gateway.
 *
 * IMPORTANT: the `roles` array of every entry is copied verbatim from the
 * previous NAV_GROUPS definition in app-layout.tsx. This module is presentation
 * only — it never grants access. Route-level guards, RLS and RPC checks are
 * untouched by this phase.
 */
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Boxes,
  Briefcase,
  Building,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ClipboardList,
  Clock,
  DoorOpen,
  FileBarChart2,
  FileSpreadsheet,
  Gauge,
  GraduationCap,
  History as HistoryIcon,
  Layers3,
  LayoutDashboard,
  Library,
  Presentation,
  School,
  Settings2,
  Share2,
  ShieldAlert,
  Sparkles,
  UserCog,
  UserSquare2,
  Users,
  UsersRound,
  Wrench,
  Grid2x2,
} from "lucide-react";

export type Role = "super_admin" | "college_admin" | "read_only" | "institutional_viewer";

// prettier-ignore
export const ALL: Role[] = ["super_admin", "college_admin", "read_only", "institutional_viewer"];

/** Alias kept for readability at call sites. */
export const ALL_ROLES = ALL;

/**
 * Operational roles: every page except the reports centre is operational.
 * `read_only` («مشاهد») is a reports-only role, so it is deliberately excluded
 * here and appears ONLY on the reports entries.
 * `institutional_viewer` («مشاهد مؤسسي») browses the whole platform read-only,
 * so it is included here; write controls stay disabled by can_manage/RLS.
 */
// prettier-ignore
export const OPERATIONAL: Role[] = ["super_admin", "college_admin", "institutional_viewer"];

/** basic = إعداد أساسي · advanced = إعداد متقدم · legacy = قديم/تشخيصي */
export type AdminTier = "basic" | "advanced" | "legacy";

export type JourneyKey =
  | "org"
  | "academic"
  | "staff"
  | "hours"
  | "prep"
  | "execute"
  | "data"
  | "reports";

export interface AdminPage {
  to: string;
  label: string;
  /** Short Arabic description shown in the gateway cards and nav tooltips. */
  desc: string;
  icon: LucideIcon;
  roles: Role[];
  tier: AdminTier;
  journey: JourneyKey;
  /** Extra keywords to improve instant search. */
  keywords?: string;
  /** Compatibility entry; its destination now lives inside preparation. */
  hiddenFromMenu?: boolean;
}

export interface Journey {
  key: JourneyKey;
  /** Ordering label prefix, e.g. "أ" */
  order: string;
  label: string;
  desc: string;
}

export const JOURNEYS: Journey[] = [
  {
    key: "org",
    order: "أ",
    label: "التهيئة الأولية",
    desc: "الجامعة والكلّيات والمستخدمون وصلاحياتهم.",
  },
  {
    key: "academic",
    order: "ب",
    label: "البنية الأكاديمية",
    desc: "الأقسام والبرامج والخطط والمقررات والفصول والدفعات الدراسية.",
  },
  {
    key: "staff",
    order: "ج",
    label: "الكادر والقاعات",
    desc: "المحاضرون وأنواعهم، والمباني والقاعات والمعامل وأنواع المحاضرات.",
  },
  {
    key: "hours",
    order: "د",
    label: "أوقات العمل والتوفر",
    desc: "ساعات الدوام والاستراحات وقوالب أوقات المحاضرات وعدم التوفّر.",
  },
  {
    key: "prep",
    order: "هـ",
    label: "تجهيز الجدولة",
    desc: "الأعداد المعتمدة ومجموعات المحاضرات والإسناد التدريسي وإعدادات القيود.",
  },
  {
    key: "execute",
    order: "و",
    label: "تنفيذ الجدول والتحقق",
    desc: "بناء الجدول والجدولة التلقائية والنسخ والتعارضات والجودة والنشر.",
  },
  {
    key: "data",
    order: "ز",
    label: "البيانات والاستيراد",
    desc: "دليل التجهيز والاستيراد من Excel وسجل الاستيراد وتنظيف البيانات.",
  },
  {
    key: "reports",
    order: "ح",
    label: "التقارير",
    desc: "تقارير الجداول والتحليلات والتقارير الرسمية.",
  },
];

export const ADMIN_PAGES: AdminPage[] = [
  // أ) التهيئة الأولية
  {
    to: "/universities",
    label: "الجامعة",
    desc: "بيانات الجامعة الأساسية.",
    icon: Building2,
    roles: ["super_admin"],
    tier: "basic",
    journey: "org",
  },
  {
    to: "/colleges",
    label: "الكلّيات",
    desc: "إضافة الكلّيات وتعديل بياناتها.",
    icon: School,
    roles: ["super_admin"],
    tier: "basic",
    journey: "org",
  },
  {
    to: "/my-college",
    label: "كلّيتي",
    desc: "الكلّيات المُسنَدة إلى حسابك.",
    icon: School,
    roles: ["college_admin", "institutional_viewer"],
    tier: "basic",
    journey: "org",
  },
  {
    to: "/users",
    label: "المستخدمون",
    desc: "إنشاء الحسابات وإسناد الأدوار والكلّيات.",
    icon: Users,
    roles: ["super_admin"],
    tier: "advanced",
    journey: "org",
    keywords: "صلاحيات أدوار حساب",
  },

  // ب) البنية الأكاديمية
  {
    to: "/departments",
    label: "الأقسام",
    desc: "أقسام الكلّية.",
    icon: Building2,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "academic",
  },
  {
    to: "/programs",
    label: "البرامج",
    desc: "البرامج الأكاديمية داخل كل قسم.",
    icon: GraduationCap,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "academic",
  },
  {
    to: "/study-plans",
    label: "الخطط الدراسية",
    desc: "خطط البرامج ومحاضرات مقرراتها.",
    icon: BookOpen,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "academic",
  },
  {
    to: "/courses",
    label: "المقررات",
    desc: "كتالوج المقررات.",
    icon: Library,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "academic",
  },
  {
    to: "/shared-courses",
    label: "المقررات المشتركة",
    desc: "المقررات المرتبطة بأكثر من برنامج.",
    icon: Share2,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "academic",
  },
  {
    to: "/terms",
    label: "الفصول الأكاديمية",
    desc: "السنوات والفصول الدراسية.",
    icon: CalendarRange,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "academic",
  },
  {
    to: "/academic-calendar",
    label: "التقويم الأكاديمي",
    desc: "بداية ونهاية الفصل والعُطل.",
    icon: CalendarDays,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "academic",
  },
  {
    to: "/academic-cohorts",
    label: "الدفعات الدراسية",
    desc: "الدفعات ومنهجها المولَّد والمقررات الاختيارية المعتمدة.",
    icon: Layers3,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "academic",
    keywords: "دفعة كوهورت",
  },

  // ج) الكادر والقاعات
  {
    to: "/instructors",
    label: "المحاضرون",
    desc: "بيانات أعضاء هيئة التدريس.",
    icon: UserSquare2,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "staff",
  },
  {
    to: "/instructor-types",
    label: "أنواع المحاضرين",
    desc: "تصنيفات المحاضرين والنصاب الافتراضي.",
    icon: UserCog,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "staff",
  },
  {
    to: "/rooms",
    label: "القاعات والمعامل",
    desc: "القاعات وسِعاتها وأنواعها.",
    icon: DoorOpen,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "staff",
  },
  {
    to: "/buildings",
    label: "المباني",
    desc: "مباني الكلّية.",
    icon: Building,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "staff",
  },
  {
    to: "/room-types",
    label: "أنواع القاعات",
    desc: "تصنيف القاعات (قاعة، معمل، ورشة).",
    icon: Boxes,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "staff",
  },
  {
    to: "/session-types",
    label: "أنواع المحاضرات",
    desc: "نظري، عملي، معمل، تمارين.",
    icon: Presentation,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "staff",
  },

  // د) أوقات العمل والتوفر
  {
    to: "/time-slot-templates",
    label: "قوالب أوقات المحاضرات",
    desc: "المرجع المعتمد لأوقات المحاضرات المستخدمة في الجدولة.",
    icon: Clock,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "hours",
    keywords: "فترات محاضرات قالب زمني",
  },
  {
    to: "/time-slots",
    label: "ساعات وفترات الدوام",
    desc: "أيام وساعات الدوام الرسمية للكلّية — ليست أوقات المحاضرات؛ أوقات المحاضرات تُدار من القوالب.",
    icon: Clock,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "hours",
    keywords: "أيام الدوام ساعات العمل",
  },
  {
    to: "/daily-breaks",
    label: "الاستراحات اليومية",
    desc: "فترات الاستراحة التي لا تُجدول فيها محاضرات.",
    icon: Clock,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "hours",
  },
  {
    to: "/availability",
    label: "عدم التوفّر",
    desc: "أوقات عدم توفّر المحاضرين والقاعات.",
    icon: CalendarClock,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "hours",
  },

  // هـ) تجهيز الجدولة
  {
    to: "/scheduling-headcounts",
    label: "أعداد الدفعات المعتمدة للجدولة",
    desc: "الأعداد المعتمدة التي تحدد عدد المجموعات.",
    icon: Users,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "prep",
  },
  {
    to: "/delivery-groups",
    label: "مجموعات المحاضرات والمعامل",
    desc: "المجموعات المولَّدة لكل مقرر ومحاضرة.",
    icon: UsersRound,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "prep",
  },
  {
    to: "/teaching-assignments",
    label: "الإسناد التدريسي",
    desc: "إسناد المحاضرين إلى مجموعات المحاضرات والمعامل.",
    icon: Briefcase,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "prep",
  },
  {
    to: "/scheduling-settings",
    label: "إعدادات الجدولة",
    desc: "إعدادات تشغيل الجدولة للكلّية.",
    icon: Settings2,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "prep",
  },
  {
    to: "/constraint-settings",
    label: "إعدادات القيود (الجدولة)",
    desc: "أوزان القيود وتفضيلات التوزيع.",
    icon: Settings2,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "prep",
  },
  {
    to: "/data-readiness",
    label: "جاهزية البيانات",
    desc: "فحص اكتمال البيانات قبل بناء الجدول.",
    icon: Gauge,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "prep",
  },

  // و) تنفيذ الجدول والتحقق
  {
    to: "/schedule-builder",
    label: "بناء الجدول",
    desc: "محرر الجدول الأسبوعي.",
    icon: CalendarRange,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "execute",
  },
  {
    to: "/auto-schedule",
    label: "الجدولة التلقائية",
    desc: "توليد مقترح جدول آلي.",
    icon: Sparkles,
    roles: ["super_admin", "college_admin"],
    tier: "advanced",
    journey: "execute",
  },
  {
    to: "/schedule-versions",
    label: "نسخ الجدول",
    desc: "إنشاء النسخ ومراجعتها واعتمادها.",
    icon: ShieldAlert,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "execute",
  },
  {
    to: "/conflict-checks",
    label: "فحص التعارضات",
    desc: "تشغيل الفحص وعرض نتائجه.",
    icon: ShieldAlert,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "execute",
  },
  {
    to: "/schedule-quality",
    label: "جودة الجدول",
    desc: "مؤشرات جودة النسخة.",
    icon: Gauge,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "execute",
  },
  {
    to: "/published-schedules",
    label: "الجداول المنشورة",
    desc: "الجداول الرسمية المتاحة للعرض والطباعة.",
    icon: CalendarClock,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "execute",
  },

  // ز) البيانات والاستيراد
  {
    to: "/data-onboarding",
    label: "تجهيز بيانات الكلية",
    desc: "خطوات التجهيز، حالة الاكتمال والقوالب والاستيراد في مكان واحد.",
    icon: ClipboardList,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "data",
  },
  {
    to: "/data-templates",
    hiddenFromMenu: true,
    label: "دليل تجهيز البيانات",
    desc: "تنزيل ملفات Excel الجاهزة للتعبئة.",
    icon: FileSpreadsheet,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "data",
  },
  {
    to: "/import",
    hiddenFromMenu: true,
    label: "استيراد البيانات من Excel",
    desc: "رفع الملفات المعبّأة واعتمادها.",
    icon: FileSpreadsheet,
    roles: ["super_admin", "college_admin"],
    tier: "basic",
    journey: "data",
  },
  {
    to: "/import-history",
    label: "سجل الاستيراد",
    desc: "عمليات الاستيراد السابقة ونتائجها.",
    icon: HistoryIcon,
    roles: OPERATIONAL,
    tier: "basic",
    journey: "data",
  },
  {
    to: "/data-cleanup",
    label: "تنظيف البيانات",
    desc: "معالجة التكرار والبيانات الناقصة.",
    icon: Wrench,
    roles: ["super_admin", "college_admin"],
    tier: "advanced",
    journey: "data",
  },
  {
    to: "/import-templates",
    label: "قوالب الاستيراد (متقدم)",
    desc: "عقود القوالب التقنية — للمراجعة المتقدمة فقط؛ ابدأ من دليل تجهيز البيانات.",
    icon: FileSpreadsheet,
    roles: OPERATIONAL,
    tier: "advanced",
    journey: "data",
  },

  // ح) التقارير
  {
    to: "/reports",
    label: "مركز التقارير",
    desc: "كل التقارير الأكاديمية والرسمية.",
    icon: FileBarChart2,
    roles: ALL,
    tier: "basic",
    journey: "reports",
  },
];

/**
 * Legacy / diagnostic routes. Never shown in primary navigation, and never in the
 * default gateway grid — only inside the collapsed «أدوات قديمة وتشخيصية» section.
 * Direct URL access and route guards are unchanged.
 */
export const LEGACY_ADMIN_PAGES: AdminPage[] = [
  {
    to: "/sections",
    label: "سجل المجموعات (Legacy)",
    desc: "Legacy — للعرض التاريخي فقط. البديل الحديث: مجموعات المحاضرات والمعامل.",
    icon: Grid2x2,
    roles: OPERATIONAL,
    tier: "legacy",
    journey: "prep",
  },
  {
    to: "/course-offerings",
    label: "طروحات المقررات (تشخيصي)",
    desc: "شاشة تشخيصية للبيانات المولَّدة — لا تُستخدم في التشغيل اليومي.",
    icon: ClipboardList,
    roles: OPERATIONAL,
    tier: "legacy",
    journey: "prep",
  },
];

export interface CoreStep {
  to: string;
  /** Step badge text: "١" … or null for entry points. */
  step: string | null;
  label: string;
  desc: string;
  icon: LucideIcon;
  roles: Role[];
}

/** The default operational path — home plus four task-oriented entries. */
export const CORE_PATH: CoreStep[] = [
  {
    to: "/dashboard",
    step: null,
    label: "الرئيسية",
    desc: "نظرة عامة على حالة الكلّية.",
    icon: LayoutDashboard,
    roles: OPERATIONAL,
  },
  {
    to: "/data-onboarding",
    step: "1",
    label: "تجهيز البيانات",
    desc: "أكمل بيانات الكلّية قبل بناء الجدول.",
    icon: ClipboardList,
    roles: OPERATIONAL,
  },
  {
    to: "/schedule-builder",
    step: "2",
    label: "بناء الجدول",
    desc: "وزّع المحاضرات على الأيام والقاعات.",
    icon: CalendarRange,
    roles: OPERATIONAL,
  },
  {
    to: "/schedule-versions",
    step: "3",
    label: "المراجعة والاعتماد",
    desc: "راجع النسخة وافحص التعارضات ثم اعتمدها.",
    icon: ShieldAlert,
    roles: OPERATIONAL,
  },
  {
    to: "/reports",
    step: "4",
    label: "التقارير والطباعة",
    desc: "تقارير الجداول والأعباء والجودة.",
    icon: FileBarChart2,
    roles: ALL,
  },
];

export const ADMIN_TOOLS_PAGE = {
  to: "/admin-tools",
  label: "مركز الأدوات الإدارية",
  desc: "كل صفحات الإعداد مرتبة حسب رحلة العمل، مع بحث فوري.",
};

export function canAccess(page: { roles: Role[] }, roles: Role[] | undefined): boolean {
  if (!roles) return true;
  return roles.some((r) => page.roles.includes(r));
}

export function matchesQuery(page: AdminPage, q: string): boolean {
  const needle = q.trim();
  if (!needle) return true;
  return `${page.label} ${page.desc} ${page.keywords ?? ""} ${page.to}`.includes(needle);
}

export function pagesByJourney(pages: AdminPage[]): Map<JourneyKey, AdminPage[]> {
  const map = new Map<JourneyKey, AdminPage[]>();
  for (const j of JOURNEYS) map.set(j.key, []);
  for (const p of pages) map.get(p.journey)?.push(p);
  return map;
}

/** Resolve the breadcrumb (section ← page) for a pathname. */
export function resolveBreadcrumb(
  pathname: string,
): { section: string; page: string; to: string } | null {
  const core = CORE_PATH.find((c) => c.to === pathname);
  if (core) return { section: "المسار التشغيلي", page: core.label, to: core.to };
  const all = [...ADMIN_PAGES, ...LEGACY_ADMIN_PAGES];
  const exact =
    all.find((p) => p.to === pathname) ??
    all.find((p) => p.to !== "/" && pathname.startsWith(`${p.to}/`));
  if (exact) {
    const j = JOURNEYS.find((x) => x.key === exact.journey);
    return { section: j?.label ?? "الأدوات الإدارية", page: exact.label, to: exact.to };
  }
  if (pathname.startsWith("/admin-tools")) {
    return { section: "الأدوات الإدارية", page: ADMIN_TOOLS_PAGE.label, to: "/admin-tools" };
  }
  return null;
}
