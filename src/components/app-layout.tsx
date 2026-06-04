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
  ClipboardList,
  Clock,
  DoorOpen,
  FileSpreadsheet,
  GraduationCap,
  LayoutDashboard,
  Library,
  LogOut,
  Presentation,
  School,
  Settings2,
  Share2,
  UserCog,
  UserSquare2,
  Users,
  Users2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: Array<"super_admin" | "college_admin" | "read_only">;
  group?: string;
}

const ALL: NavItem["roles"] = ["super_admin", "college_admin", "read_only"];

const NAV: NavItem[] = [
  { to: "/dashboard", label: "لوحة التحكم", icon: <LayoutDashboard className="h-4 w-4" />, roles: ALL },
  { to: "/universities", label: "الجامعة", icon: <Building2 className="h-4 w-4" />, roles: ["super_admin"], group: "إدارة النظام" },
  { to: "/colleges", label: "الكلّيات", icon: <School className="h-4 w-4" />, roles: ["super_admin"], group: "إدارة النظام" },
  { to: "/users", label: "المستخدمون", icon: <Users className="h-4 w-4" />, roles: ["super_admin"], group: "إدارة النظام" },
  { to: "/my-college", label: "كلّيتي", icon: <School className="h-4 w-4" />, roles: ["college_admin", "read_only"], group: "كلّيتي" },
  { to: "/departments", label: "الأقسام", icon: <Building2 className="h-4 w-4" />, roles: ALL, group: "البنية الأكاديمية" },
  { to: "/programs", label: "البرامج", icon: <GraduationCap className="h-4 w-4" />, roles: ALL, group: "البنية الأكاديمية" },
  { to: "/study-plans", label: "الخطط الدراسية", icon: <BookOpen className="h-4 w-4" />, roles: ALL, group: "البنية الأكاديمية" },
  { to: "/courses", label: "المقررات", icon: <Library className="h-4 w-4" />, roles: ALL, group: "البنية الأكاديمية" },
  { to: "/terms", label: "الفصول الدراسية", icon: <CalendarRange className="h-4 w-4" />, roles: ALL, group: "البنية الأكاديمية" },
  { to: "/sections", label: "الشُّعب", icon: <Users2 className="h-4 w-4" />, roles: ALL, group: "البنية الأكاديمية" },
  { to: "/instructors", label: "المحاضرون", icon: <UserSquare2 className="h-4 w-4" />, roles: ALL, group: "موارد التدريس" },
  { to: "/rooms", label: "القاعات والمختبرات", icon: <DoorOpen className="h-4 w-4" />, roles: ALL, group: "موارد التدريس" },
  { to: "/time-slots", label: "الفترات الزمنية", icon: <Clock className="h-4 w-4" />, roles: ALL, group: "موارد التدريس" },
  { to: "/availability", label: "التوفّر/عدم التوفّر", icon: <CalendarClock className="h-4 w-4" />, roles: ALL, group: "موارد التدريس" },
  { to: "/course-offerings", label: "مقررات الفصل", icon: <ClipboardList className="h-4 w-4" />, roles: ALL, group: "موارد التدريس" },
  { to: "/teaching-assignments", label: "التكليفات التدريسية", icon: <Briefcase className="h-4 w-4" />, roles: ALL, group: "موارد التدريس" },
  { to: "/instructor-types", label: "أنواع المحاضرين", icon: <UserCog className="h-4 w-4" />, roles: ALL, group: "التهيئة الأكاديمية" },
  { to: "/room-types", label: "أنواع القاعات", icon: <Boxes className="h-4 w-4" />, roles: ALL, group: "التهيئة الأكاديمية" },
  { to: "/buildings", label: "المباني", icon: <Building className="h-4 w-4" />, roles: ALL, group: "التهيئة الأكاديمية" },
  { to: "/session-types", label: "أنواع الجلسات", icon: <Presentation className="h-4 w-4" />, roles: ALL, group: "التهيئة الأكاديمية" },
  { to: "/scheduling-settings", label: "إعدادات الجدولة", icon: <Settings2 className="h-4 w-4" />, roles: ALL, group: "التهيئة الأكاديمية" },
  { to: "/academic-calendar", label: "التقويم الأكاديمي", icon: <CalendarDays className="h-4 w-4" />, roles: ALL, group: "التهيئة الأكاديمية" },
  { to: "/shared-courses", label: "المقررات المشتركة", icon: <Share2 className="h-4 w-4" />, roles: ALL, group: "التهيئة الأكاديمية" },
  { to: "/import-templates", label: "قوالب الاستيراد", icon: <FileSpreadsheet className="h-4 w-4" />, roles: ALL, group: "التهيئة الأكاديمية" },
];


export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("تم تسجيل الخروج");
    navigate({ to: "/auth", replace: true });
  };

  const items = NAV.filter((n) => !user || user.roles.some((r) => n.roles.includes(r)));
  const roleLabel = user?.isSuperAdmin
    ? "مدير عام"
    : user?.isCollegeAdmin
      ? "مدير كلّية"
      : user?.isReadOnly
        ? "قراءة فقط"
        : "—";

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-l border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-white/10">
            <GraduationCap className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">منصّة الجداول</p>
            <p className="text-[11px] text-sidebar-foreground/70">إدارة جامعية</p>
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
          {Array.from(
            items.reduce((m, it) => {
              const k = it.group ?? "";
              if (!m.has(k)) m.set(k, []);
              m.get(k)!.push(it);
              return m;
            }, new Map<string, NavItem[]>()),
          ).map(([group, list]) => (
            <div key={group} className="space-y-1">
              {group && <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">{group}</p>}
              {list.map((item) => {
                const active = pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
                    )}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-sidebar-border p-4">
          <div className="mb-3">
            <p className="truncate text-sm font-medium">{user?.fullName ?? user?.email ?? "—"}</p>
            <p className="mt-1 inline-block rounded bg-white/10 px-2 py-0.5 text-[11px]">{roleLabel}</p>
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

      <main className="flex-1 px-6 py-8 md:px-10">
        {isLoading ? (
          <div className="grid h-64 place-items-center text-muted-foreground">جارٍ التحميل...</div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
