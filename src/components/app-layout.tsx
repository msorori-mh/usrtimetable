import { preparationStepForPath } from "@/lib/data-onboarding/preparation";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  LayoutGrid,
  LogOut,
  Menu,
  School,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useActiveCollege } from "@/hooks/use-colleges";
import { toast } from "sonner";
import { UsrBrandMark } from "@/components/branding/usr-brand-mark";
import { USR_PLATFORM_NAME_AR, USR_UNIVERSITY_NAME_AR } from "@/lib/branding/usr";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import {
  ADMIN_PAGES,
  ADMIN_TOOLS_PAGE,
  CORE_PATH,
  JOURNEYS,
  canAccess,
  matchesQuery,
  pagesByJourney,
  resolveBreadcrumb,
  type AdminPage,
  type CoreStep,
  type JourneyKey,
  type Role,
} from "@/lib/admin-nav";
import { cn } from "@/lib/utils";
import { ACADEMIC_AFFAIRS_ROLE_LABEL_AR, isReportsOnlyRole } from "@/lib/academic-affairs-role";

type NavMode = "core" | "all";

const NAV_MODE_STORAGE_KEY = "usr.admin.navMode";

function isActivePath(itemPath: string, pathname: string): boolean {
  if (itemPath === pathname) return true;
  return itemPath !== "/" && pathname.startsWith(`${itemPath}/`);
}

function readStoredMode(): NavMode {
  try {
    const v = window.localStorage.getItem(NAV_MODE_STORAGE_KEY);
    return v === "all" ? "all" : "core";
  } catch {
    return "core";
  }
}

/** Core operational path — six primary entries with clear step badges. */
function CorePathNav({
  steps,
  pathname,
  onNavigate,
  tone,
}: {
  steps: CoreStep[];
  pathname: string;
  onNavigate?: () => void;
  tone: "sidebar" | "sheet";
}) {
  return (
    <div className="space-y-1">
      {steps.map((s) => {
        const active = isActivePath(s.to, pathname);
        const Icon = s.icon;
        return (
          <Link
            key={s.to}
            to={s.to}
            onClick={onNavigate}
            data-core-nav-link={s.to}
            className={cn(
              "relative flex items-start gap-3 rounded-lg px-3 py-2.5 transition",
              tone === "sidebar"
                ? active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-sidebar-foreground"
                : active
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted",
            )}
          >
            {active && (
              <span className="absolute inset-y-2 right-0 w-[3px] rounded-full bg-[var(--usr-gold)]" />
            )}
            <span
              className={cn(
                "grid h-7 w-7 shrink-0 place-items-center rounded-md text-[11px] font-bold",
                active
                  ? "bg-primary text-primary-foreground"
                  : tone === "sidebar"
                    ? "bg-white/10 text-sidebar-foreground/70"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {s.step ?? <Icon className="h-4 w-4" />}
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate text-[13px]", active && "font-bold")}>
                {s.label}
              </span>
              <span
                className={cn(
                  "mt-0.5 block text-[10.5px] leading-snug",
                  tone === "sidebar" ? "text-sidebar-foreground/55" : "text-muted-foreground",
                )}
              >
                {s.desc}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** All-tools mode: instant search + collapsible logical sections. */
function AllToolsNav({
  pages,
  pathname,
  activeJourney,
  onNavigate,
  tone,
}: {
  pages: AdminPage[];
  pathname: string;
  activeJourney: JourneyKey | null;
  onNavigate?: () => void;
  tone: "sidebar" | "sheet";
}) {
  const [query, setQuery] = useState("");
  const [openKeys, setOpenKeys] = useState<JourneyKey[]>(activeJourney ? [activeJourney] : []);

  useEffect(() => {
    if (activeJourney) setOpenKeys([activeJourney]);
  }, [activeJourney]);

  const filtered = useMemo(() => pages.filter((p) => matchesQuery(p, query)), [pages, query]);
  const grouped = useMemo(() => pagesByJourney(filtered), [filtered]);
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="ابحث عن صفحة…"
          aria-label="بحث فوري عن صفحة"
          data-testid="nav-page-search"
          className={cn(
            "h-8 pr-8 text-xs",
            tone === "sidebar" &&
              "border-sidebar-border/60 bg-white/5 text-sidebar-foreground placeholder:text-sidebar-foreground/40",
          )}
        />
      </div>

      {filtered.length === 0 && (
        <p
          className={cn(
            "px-2 py-3 text-xs",
            tone === "sidebar" ? "text-sidebar-foreground/60" : "text-muted-foreground",
          )}
        >
          لا توجد صفحة مطابقة.
        </p>
      )}

      {JOURNEYS.map((j) => {
        const items = grouped.get(j.key) ?? [];
        if (items.length === 0) return null;
        const isOpen = searching || openKeys.includes(j.key);
        const hasActive = items.some((it) => isActivePath(it.to, pathname));
        return (
          <div key={j.key} className="rounded-lg">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() =>
                setOpenKeys((keys) =>
                  keys.includes(j.key) ? keys.filter((k) => k !== j.key) : [...keys, j.key],
                )
              }
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[11px] font-bold tracking-wide transition",
                tone === "sidebar"
                  ? hasActive
                    ? "text-sidebar-foreground"
                    : "text-sidebar-foreground/55 hover:bg-white/5 hover:text-sidebar-foreground"
                  : hasActive
                    ? "text-primary"
                    : "text-muted-foreground hover:bg-muted",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                    hasActive
                      ? "bg-[var(--usr-gold)]"
                      : tone === "sidebar"
                        ? "bg-sidebar-foreground/25"
                        : "bg-muted-foreground/30",
                  )}
                />
                <span className="truncate">{j.label}</span>
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-medium",
                    tone === "sidebar"
                      ? "bg-white/5 text-sidebar-foreground/60"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {items.length}
                </span>
              </span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 transition-transform", isOpen && "rotate-180")}
              />
            </button>
            {isOpen && (
              <div className="mt-1 space-y-0.5 pb-1">
                {items.map((item) => {
                  const active = isActivePath(item.to, pathname);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onNavigate}
                      title={item.desc}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] leading-none transition",
                        tone === "sidebar"
                          ? active
                            ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground shadow-sm"
                            : "text-sidebar-foreground/75 hover:bg-white/5 hover:text-sidebar-foreground"
                          : active
                            ? "bg-primary/10 font-semibold text-primary"
                            : "hover:bg-muted",
                      )}
                    >
                      {active && (
                        <span className="absolute inset-y-1.5 right-0 w-0.5 rounded-full bg-[var(--usr-gold)]" />
                      )}
                      <Icon className="h-4 w-4 shrink-0 opacity-80" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { data: user, isLoading } = useCurrentUser();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({
    select: (state: { location: { pathname: string } }) => state.location.pathname,
  });
  const [mode, setMode] = useState<NavMode>("core");
  const [mobileOpen, setMobileOpen] = useState(false);
  const { active: activeCollege } = useActiveCollege();

  useEffect(() => {
    setMode(readStoredMode());
  }, []);

  const setNavMode = (next: NavMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(NAV_MODE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — non-fatal, mode stays in memory */
    }
  };

  const handleSignOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    toast.success("تم تسجيل الخروج");
    navigate({ to: "/auth", replace: true });
  };

  const roles = user?.roles as Role[] | undefined;
  /** Academic affairs («إدارة الشؤون الأكاديمية»): reports centre only. */
  const reportsOnly = isReportsOnlyRole(user);
  const effectiveMode: NavMode = reportsOnly ? "core" : mode;

  const coreSteps = useMemo(() => CORE_PATH.filter((s) => canAccess(s, roles)), [roles]);
  const toolPages = useMemo(
    () => ADMIN_PAGES.filter((p) => !p.hiddenFromMenu && canAccess(p, roles)),
    [roles],
  );

  const activeJourney = useMemo<JourneyKey | null>(() => {
    const hit =
      toolPages.find((p) => p.to === pathname) ??
      toolPages.find((p) => isActivePath(p.to, pathname));
    return hit?.journey ?? null;
  }, [toolPages, pathname]);

  const preparationStep = preparationStepForPath(pathname);

  const crumb = useMemo(() => resolveBreadcrumb(pathname), [pathname]);

  const roleLabel = user?.isSuperAdmin
    ? "Super Admin"
    : user?.isInstitutionalViewer
      ? ACADEMIC_AFFAIRS_ROLE_LABEL_AR
      : user?.isCollegeAdmin
        ? "مدير كلّية"
        : user?.isReadOnly
          ? "مشاهد"
          : "—";

  const modeToggle = reportsOnly ? null : (
    <button
      type="button"
      onClick={() => setNavMode(mode === "core" ? "all" : "core")}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-sidebar-border/60 bg-white/5 px-3 py-2 text-right text-xs transition hover:bg-white/10"
      data-testid="navigation-mode-toggle"
    >
      <span>
        <span className="block font-semibold">
          {mode === "all" ? "كل الأدوات" : "المسار التشغيلي"}
        </span>
        <span className="mt-0.5 block text-[10px] text-sidebar-foreground/60">
          {mode === "all" ? "العودة إلى الخطوات الأربع" : "بحث وأقسام كل صفحات الإعداد"}
        </span>
      </span>
      <SlidersHorizontal className="h-4 w-4 shrink-0 text-primary" />
    </button>
  );

  const navBody = (tone: "sidebar" | "sheet", onNavigate?: () => void) =>
    effectiveMode === "core" ? (
      <>
        <p
          className={cn(
            "px-2 pb-2 text-[11px] leading-snug",
            tone === "sidebar" ? "text-sidebar-foreground/55" : "text-muted-foreground",
          )}
        >
          {reportsOnly
            ? "حساب إدارة الشؤون الأكاديمية: مركز التقارير للكلّيات المُسندة لك."
            : "أربع خطوات: تجهيز البيانات، إنشاء الجدول، المراجعة والاعتماد، التقارير والطباعة."}
        </p>
        <CorePathNav steps={coreSteps} pathname={pathname} onNavigate={onNavigate} tone={tone} />
        {!reportsOnly && (
          <Link
            to={ADMIN_TOOLS_PAGE.to}
            onClick={onNavigate}
            className={cn(
              "mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-[12px] font-semibold transition",
              tone === "sidebar"
                ? "border-sidebar-border/60 bg-white/5 text-sidebar-foreground hover:bg-white/10"
                : "border-border bg-secondary text-primary hover:bg-secondary/80",
            )}
          >
            <LayoutGrid className="h-4 w-4 shrink-0" />
            {ADMIN_TOOLS_PAGE.label}
          </Link>
        )}
      </>
    ) : (
      <AllToolsNav
        pages={toolPages}
        pathname={pathname}
        activeJourney={activeJourney}
        onNavigate={onNavigate}
        tone={tone}
      />
    );

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row" data-app-shell="root">
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
        <div className="border-b border-sidebar-border px-3 py-3">{modeToggle}</div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">{navBody("sidebar")}</nav>
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

      <header
        className="sticky top-0 z-40 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:hidden"
        data-app-chrome="mobile-header"
      >
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <UsrBrandMark size="sm" />
            <div className="min-w-0">
              <p className="truncate text-xs font-bold">{USR_UNIVERSITY_NAME_AR}</p>
              <p className="truncate text-[10px] text-muted-foreground">{USR_PLATFORM_NAME_AR}</p>
            </div>
          </div>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-card"
              aria-label="فتح قائمة التنقل"
              data-testid="mobile-nav-trigger"
            >
              <Menu className="h-5 w-5" />
            </SheetTrigger>
            <SheetContent
              side="right"
              className="flex w-[min(20rem,90vw)] flex-col gap-0 overflow-y-auto p-4"
            >
              <SheetTitle className="mb-3 text-sm font-bold">التنقل</SheetTitle>
              {!reportsOnly && (
                <button
                  type="button"
                  onClick={() => setNavMode(mode === "core" ? "all" : "core")}
                  className="mb-3 flex w-full items-center justify-between rounded-lg bg-secondary px-3 py-2 text-sm font-medium text-primary"
                  data-testid="mobile-navigation-mode-toggle"
                >
                  {mode === "all" ? "العودة إلى المسار التشغيلي" : "عرض كل الأدوات"}
                  <SlidersHorizontal className="h-4 w-4" />
                </button>
              )}
              {navBody("sheet", () => setMobileOpen(false))}
            </SheetContent>
          </Sheet>
        </div>
      </header>

      <main className="usr-internal-main min-w-0 flex-1 px-4 py-5 sm:px-6 md:px-10 md:py-7">
        {(crumb || activeCollege) && (
          <div
            className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 pb-3"
            data-testid="page-context-bar"
            data-app-chrome="context-bar"
          >
            <nav aria-label="مسار التنقل" className="min-w-0 text-xs text-muted-foreground">
              {crumb ? (
                <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span>{crumb.section}</span>
                  <span aria-hidden>←</span>
                  <span className="truncate font-semibold text-foreground">{crumb.page}</span>
                </span>
              ) : null}
            </nav>
            {activeCollege && (
              <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1 text-[11px] font-medium text-primary">
                <School className="h-3.5 w-3.5" />
                <span className="max-w-[12rem] truncate">{activeCollege.name}</span>
              </span>
            )}
          </div>
        )}
        {preparationStep && (
          <div
            className="mb-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm"
            data-testid="preparation-return"
          >
            <Link
              to="/data-onboarding"
              search={{ step: preparationStep }}
              className="font-semibold text-primary hover:underline"
            >
              العودة إلى تجهيز بيانات الكلية ←
            </Link>
            <span className="mt-1 block text-xs text-muted-foreground">
              بعد حفظ تعديلاتك، عُد لمراجعة اكتمال الخطوة ومتابعة التجهيز.
            </span>
          </div>
        )}
        {isLoading ? (
          <div className="grid h-64 place-items-center text-muted-foreground">جارٍ التحميل...</div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
