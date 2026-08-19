import { useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Boxes,
  Briefcase,
  Building,
  Building2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  ChevronDown,
  ClipboardList,
  Clock,
  DoorOpen,
  FileSpreadsheet,
  FileBarChart2,
  Gauge,
  History as HistoryIcon,
  Sparkles,
  GraduationCap,
  Layers3,
  LayoutDashboard,
  Library,
  LogOut,
  Menu,
  Presentation,
  School,
  Settings2,
  ShieldAlert,
  Share2,
  SlidersHorizontal,
  UserCog,
  UserSquare2,
  Users,
  UsersRound,
  Wrench,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { toast } from "sonner";
import { UsrBrandMark } from "@/components/branding/usr-brand-mark";
import { USR_PLATFORM_NAME_AR, USR_UNIVERSITY_NAME_AR } from "@/lib/branding/usr";
import { cn } from "@/lib/utils";

type Role = "super_admin" | "college_admin" | "read_only";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: Role[];
}

interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

const ALL: Role[] = ["super_admin", "college_admin", "read_only"];

const NAV_GROUPS: NavGroup[] = [
  {
    key: "start",
    label: "البداية وتجهيز البيانات",
    items: [
      {
        to: "/dashboard",
        label: "لوحة التحكم",
        icon: <LayoutDashboard className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/data-onboarding",
        label: "إعداد البيانات وإنشاء الجدول",
        icon: <ClipboardList className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/data-templates",
        label: "دليل تجهيز البيانات",
        icon: <FileSpreadsheet className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/import",
        label: "استيراد البيانات من Excel",
        icon: <FileSpreadsheet className="h-4 w-4" />,
        roles: ["super_admin", "college_admin"],
      },
      {
        to: "/import-history",
        label: "سجل الاستيراد",
        icon: <HistoryIcon className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/import-templates",
        label: "قوالب الاستيراد",
        icon: <FileSpreadsheet className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/data-cleanup",
        label: "تنظيف البيانات",
        icon: <Wrench className="h-4 w-4" />,
        roles: ["super_admin", "college_admin"],
      },
    ],
  },
  {
    key: "org",
    label: "الهيكل المؤسسي",
    items: [
      {
        to: "/universities",
        label: "الجامعة",
        icon: <Building2 className="h-4 w-4" />,
        roles: ["super_admin"],
      },
      {
        to: "/colleges",
        label: "الكلّيات",
        icon: <School className="h-4 w-4" />,
        roles: ["super_admin"],
      },
      {
        to: "/my-college",
        label: "كلّيتي",
        icon: <School className="h-4 w-4" />,
        roles: ["college_admin", "read_only"],
      },
      {
        to: "/users",
        label: "المستخدمون",
        icon: <Users className="h-4 w-4" />,
        roles: ["super_admin"],
      },
    ],
  },
  {
    key: "academic",
    label: "البنية الأكاديمية",
    items: [
      { to: "/departments", label: "الأقسام", icon: <Building2 className="h-4 w-4" />, roles: ALL },
      {
        to: "/programs",
        label: "البرامج",
        icon: <GraduationCap className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/study-plans",
        label: "الخطط الدراسية",
        icon: <BookOpen className="h-4 w-4" />,
        roles: ALL,
      },
      { to: "/courses", label: "المقررات", icon: <Library className="h-4 w-4" />, roles: ALL },
      {
        to: "/shared-courses",
        label: "المقررات المشتركة",
        icon: <Share2 className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/terms",
        label: "الفصول الأكاديمية",
        icon: <CalendarRange className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/academic-calendar",
        label: "التقويم الأكاديمي",
        icon: <CalendarDays className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/academic-cohorts",
        label: "الدفعات الدراسية",
        icon: <Layers3 className="h-4 w-4" />,
        roles: ALL,
      },
    ],
  },
  {
    key: "teaching",
    label: "بيانات وموارد التدريس",
    items: [
      {
        to: "/instructor-types",
        label: "أنواع المحاضرين",
        icon: <UserCog className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/instructors",
        label: "المحاضرون",
        icon: <UserSquare2 className="h-4 w-4" />,
        roles: ALL,
      },
      { to: "/buildings", label: "المباني", icon: <Building className="h-4 w-4" />, roles: ALL },
      {
        to: "/room-types",
        label: "أنواع القاعات",
        icon: <Boxes className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/rooms",
        label: "القاعات والمعامل",
        icon: <DoorOpen className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/session-types",
        label: "أنواع المحاضرات",
        icon: <Presentation className="h-4 w-4" />,
        roles: ALL,
      },
    ],
  },
  {
    key: "hours",
    label: "أوقات العمل والتوفر",
    items: [
      {
        to: "/time-slots",
        label: "أيام وفترات الدوام",
        icon: <Clock className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/daily-breaks",
        label: "الاستراحات اليومية",
        icon: <Clock className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/time-slot-templates",
        label: "قوالب أوقات المحاضرات",
        icon: <Clock className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/availability",
        label: "عدم التوفّر",
        icon: <CalendarClock className="h-4 w-4" />,
        roles: ALL,
      },
    ],
  },
  {
    key: "prep",
    label: "تجهيز الجدولة",
    items: [
      {
        to: "/scheduling-headcounts",
        label: "أعداد الدفعات المعتمدة للجدولة",
        icon: <Users className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/delivery-groups",
        label: "مجموعات المحاضرات والمعامل",
        icon: <UsersRound className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/teaching-assignments",
        label: "الإسناد التدريسي",
        icon: <Briefcase className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/scheduling-settings",
        label: "إعدادات الجدولة",
        icon: <Settings2 className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/constraint-settings",
        label: "إعدادات القيود (الجدولة)",
        icon: <Settings2 className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/data-readiness",
        label: "جاهزية البيانات",
        icon: <Gauge className="h-4 w-4" />,
        roles: ALL,
      },
    ],
  },
  {
    key: "execute",
    label: "تنفيذ الجدول والتحقق",
    items: [
      {
        to: "/schedule-builder",
        label: "بناء الجدول",
        icon: <CalendarRange className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/auto-schedule",
        label: "الجدولة التلقائية",
        icon: <Sparkles className="h-4 w-4" />,
        roles: ["super_admin", "college_admin"],
      },
      {
        to: "/schedule-versions",
        label: "نسخ الجدول",
        icon: <CalendarClock className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/conflict-checks",
        label: "فحص التعارضات",
        icon: <ShieldAlert className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/schedule-quality",
        label: "جودة الجدول",
        icon: <Gauge className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/published-schedules",
        label: "الجداول المنشورة",
        icon: <CalendarClock className="h-4 w-4" />,
        roles: ALL,
      },
    ],
  },
  {
    key: "reports",
    label: "التقارير",
    items: [
      {
        to: "/reports",
        label: "التقارير",
        icon: <FileBarChart2 className="h-4 w-4" />,
        roles: ALL,
      },
    ],
  },
];

const CORE_NAV_GROUPS: NavGroup[] = [
  {
    key: "core",
    label: "المسار الأساسي",
    items: [
      {
        to: "/dashboard",
        label: "الرئيسية",
        icon: <LayoutDashboard className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/data-onboarding",
        label: "1. تجهيز البيانات",
        icon: <ClipboardList className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/schedule-builder",
        label: "2. بناء الجدول",
        icon: <CalendarRange className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/schedule-versions",
        label: "3. المراجعة والاعتماد",
        icon: <ShieldAlert className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/published-schedules",
        label: "4. النشر والجداول الرسمية",
        icon: <CalendarClock className="h-4 w-4" />,
        roles: ALL,
      },
      {
        to: "/reports",
        label: "التقارير",
        icon: <FileBarChart2 className="h-4 w-4" />,
        roles: ALL,
      },
    ],
  },
];

function isActivePath(itemPath: string, pathname: string): boolean {
  return itemPath === pathname || (itemPath === "/reports" && pathname.startsWith("/reports/"));
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({
    select: (state: { location: { pathname: string } }) => state.location.pathname,
  });
  const [advancedMode, setAdvancedMode] = useState(false);

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("تم تسجيل الخروج");
    navigate({ to: "/auth", replace: true });
  };

  const visibleGroups = useMemo(
    () =>
      (advancedMode ? NAV_GROUPS : CORE_NAV_GROUPS)
        .map((g) => ({
          ...g,
          items: g.items.filter((it) => !user || user.roles.some((r) => it.roles.includes(r))),
        }))
        .filter((g) => g.items.length > 0),
    [advancedMode, user],
  );

  const activeGroupKey = useMemo(() => {
    const g = visibleGroups.find((g) => g.items.some((it) => isActivePath(it.to, pathname)));
    return g?.key ?? visibleGroups[0]?.key ?? null;
  }, [visibleGroups, pathname]);

  const [openKey, setOpenKey] = useState<string | null>(activeGroupKey);
  const [lastActiveKey, setLastActiveKey] = useState<string | null>(activeGroupKey);
  if (activeGroupKey !== lastActiveKey) {
    setLastActiveKey(activeGroupKey);
    setOpenKey(activeGroupKey);
  }

  const roleLabel = user?.isSuperAdmin
    ? "Super Admin"
    : user?.isCollegeAdmin
      ? "مدير كلّية"
      : user?.isReadOnly
        ? "مشاهد"
        : "—";

  const toggleNavigationMode = () => {
    const next = !advancedMode;
    setAdvancedMode(next);
    setOpenKey(next ? NAV_GROUPS[0].key : CORE_NAV_GROUPS[0].key);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="usr-gold-rule shrink-0" />
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-4">
          <UsrBrandMark size="sm" className="ring-white/25" />
          <div className="min-w-0">
            <p className="text-xs font-bold leading-tight">{USR_UNIVERSITY_NAME_AR}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/75">
              {USR_PLATFORM_NAME_AR}
            </p>
          </div>
        </div>
        <div className="border-b border-sidebar-border px-3 py-3">
          <button
            type="button"
            onClick={toggleNavigationMode}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-sidebar-border/60 bg-white/5 px-3 py-2 text-right text-xs transition hover:bg-white/10"
            data-testid="navigation-mode-toggle"
          >
            <span>
              <span className="block font-semibold">
                {advancedMode ? "الأدوات المتقدمة" : "المسار الأساسي"}
              </span>
              <span className="mt-0.5 block text-[10px] text-sidebar-foreground/60">
                {advancedMode ? "العودة إلى الخطوات الأربع" : "إظهار الإعدادات والإدارة الكاملة"}
              </span>
            </span>
            <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {visibleGroups.map((group, idx) => {
            const isOpen = openKey === group.key;
            const hasActive = group.items.some((it) => isActivePath(it.to, pathname));
            return (
              <div
                key={group.key}
                className={cn("py-1", idx > 0 && "mt-1 border-t border-sidebar-border/40 pt-2")}
              >
                <button
                  type="button"
                  onClick={() => setOpenKey(isOpen ? null : group.key)}
                  aria-expanded={isOpen}
                  className={cn(
                    "group/head flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-bold tracking-wider transition",
                    hasActive
                      ? "text-sidebar-foreground"
                      : "text-sidebar-foreground/55 hover:bg-white/5 hover:text-sidebar-foreground",
                  )}
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full transition",
                        hasActive ? "bg-primary" : "bg-sidebar-foreground/25",
                      )}
                    />
                    {group.label}
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground/60">
                      {group.items.length}
                    </span>
                  </span>
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 transition-transform",
                      isOpen ? "rotate-180" : "",
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "grid overflow-hidden transition-[grid-template-rows] duration-200",
                    isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="min-h-0">
                    <div className="mt-1 space-y-0.5 pb-1 pr-2">
                      {group.items.map((item) => {
                        const active = isActivePath(item.to, pathname);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            className={cn(
                              "relative flex items-center gap-3 rounded-md px-3 py-2 text-[13px] leading-none transition",
                              active
                                ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm"
                                : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-sidebar-foreground",
                            )}
                          >
                            {active && (
                              <span className="absolute inset-y-1.5 right-0 w-0.5 rounded-full bg-primary" />
                            )}
                            <span
                              className={cn(
                                "grid h-6 w-6 shrink-0 place-items-center rounded-md transition",
                                active
                                  ? "bg-primary/15 text-primary"
                                  : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground",
                              )}
                            >
                              {item.icon}
                            </span>
                            <span className="truncate">{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="mb-3">
            <p className="truncate text-sm font-medium">{user?.fullName ?? user?.email ?? "—"}</p>
            <p className="mt-1 inline-block rounded bg-white/10 px-2 py-0.5 text-[11px]">
              {roleLabel}
            </p>
          </div>
          <button
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-md border border-sidebar-border/60 bg-white/5 px-3 py-2 text-xs font-medium hover:bg-white/10"
          >
            <LogOut className="h-3.5 w-3.5" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <UsrBrandMark size="sm" />
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{USR_UNIVERSITY_NAME_AR}</p>
              <p className="truncate text-[10px] text-muted-foreground">{USR_PLATFORM_NAME_AR}</p>
            </div>
          </div>
          <details className="group relative">
            <summary className="grid h-10 w-10 cursor-pointer list-none place-items-center rounded-lg border border-border bg-card [&::-webkit-details-marker]:hidden">
              <Menu className="h-5 w-5" />
              <span className="sr-only">فتح قائمة التنقل</span>
            </summary>
            <div className="absolute left-0 top-12 max-h-[75vh] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-xl">
              <button
                type="button"
                onClick={toggleNavigationMode}
                className="mb-3 flex w-full items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-primary"
              >
                {advancedMode ? "العودة إلى المسار الأساسي" : "عرض الأدوات المتقدمة"}
                <SlidersHorizontal className="h-4 w-4" />
              </button>
              {visibleGroups.map((group) => (
                <section key={group.key} className="border-t border-border/60 py-2 first:border-0">
                  <p className="px-2 py-1 text-xs font-bold text-muted-foreground">{group.label}</p>
                  <div className="space-y-1">
                    {group.items.map((item) => {
                      const active = isActivePath(item.to, pathname);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                            active ? "bg-primary/10 font-semibold text-primary" : "hover:bg-muted",
                          )}
                        >
                          {item.icon}
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </details>
        </div>
      </header>

      <main className="usr-internal-main min-w-0 flex-1 px-4 py-6 sm:px-6 md:px-10 md:py-8">
        {isLoading ? (
          <div className="grid h-64 place-items-center text-muted-foreground">جارٍ التحميل...</div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
