import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarCheck2,
  CalendarRange,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileBarChart2,
  School,
  ShieldCheck,
  Users,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fetchOnboardingReadinessSnapshot } from "@/lib/data-onboarding";
import {
  resolveCoreWorkflow,
  type CoreWorkflowStageId,
  type CoreWorkflowStageState,
} from "@/lib/core-workflow";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "الرئيسية — إدارة الجدول" }] }),
  component: Dashboard,
});

const STAGE_ICONS: Record<CoreWorkflowStageId, React.ReactNode> = {
  prepare: <ClipboardCheck className="h-5 w-5" />,
  build: <CalendarRange className="h-5 w-5" />,
  review: <ShieldCheck className="h-5 w-5" />,
  publish: <CalendarCheck2 className="h-5 w-5" />,
};

function Dashboard() {
  const { data: user } = useCurrentUser();
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();

  const { data: organizationStats } = useQuery({
    queryKey: ["dashboard-organization-stats"],
    enabled: !!user?.isSuperAdmin,
    queryFn: async () => {
      const [universities, colleges, profiles] = await Promise.all([
        supabase.from("universities").select("id", { count: "exact", head: true }),
        supabase.from("colleges").select("id", { count: "exact", head: true }),
        supabase.from("profiles").select("id", { count: "exact", head: true }),
      ]);
      return {
        universities: universities.count ?? 0,
        colleges: colleges.count ?? 0,
        users: profiles.count ?? 0,
      };
    },
  });

  const readiness = useQuery({
    queryKey: ["dashboard-core-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchOnboardingReadinessSnapshot(active!.id),
  });

  const scheduleSummary = useQuery({
    queryKey: ["dashboard-schedule-summary", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, status")
        .eq("college_id", active!.id);
      if (error) throw error;
      const versions = data ?? [];
      return {
        total: versions.length,
        published: versions.filter((version) => version.status === "published").length,
      };
    },
  });

  const workflow = resolveCoreWorkflow({
    hasActiveCollege: !!active,
    readinessPercent: readiness.data?.percentComplete ?? null,
    blockerCount: readiness.data?.severityCounts.BLOCKER ?? null,
    scheduleVersionCount: scheduleSummary.data?.total ?? 0,
    publishedVersionCount: scheduleSummary.data?.published ?? 0,
  });

  return (
    <div className="mx-auto max-w-6xl space-y-7" dir="rtl">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">مرحباً، {user?.fullName ?? user?.email}</p>
          <h1 className="mt-1 text-3xl font-bold">إدارة الجدول الجامعي</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            اتبع أربع خطوات واضحة. جميع محركات التعارضات والجودة والصلاحيات تعمل في الخلفية كما هي.
          </p>
        </div>
        <CollegeSwitcher />
      </header>

      <Card className="overflow-hidden border-primary/25 shadow-[var(--shadow-card)]">
        <div className="grid gap-5 bg-primary/[0.04] p-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">الخطوة التالية</Badge>
              {active ? (
                <span className="text-xs text-muted-foreground">{active.name}</span>
              ) : (
                <span className="text-xs text-amber-700">اختر كلية أولاً</span>
              )}
            </div>
            <h2 className="mt-3 text-2xl font-bold">{workflow.nextStage.titleAr}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{workflow.nextStage.descriptionAr}</p>
            {readiness.data ? (
              <div className="mt-4 max-w-lg space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>جاهزية البيانات</span>
                  <span className="font-semibold">{readiness.data.percentComplete}%</span>
                </div>
                <Progress value={readiness.data.percentComplete} className="h-2" />
              </div>
            ) : null}
          </div>
          {active ? (
            <Button asChild size="lg">
              <Link to={workflow.nextStage.href}>
                {canManage ? "متابعة العمل" : "عرض الحالة"}
                {canManage ? (
                  <ArrowLeft className="mr-2 h-4 w-4" />
                ) : (
                  <Eye className="mr-2 h-4 w-4" />
                )}
              </Link>
            </Button>
          ) : (
            <Button size="lg" disabled>
              اختر كلية للمتابعة
            </Button>
          )}
        </div>
      </Card>

      <section aria-labelledby="workflow-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="workflow-heading" className="text-lg font-semibold">
              مسار العمل
            </h2>
            <p className="text-sm text-muted-foreground">ابدأ من اليمين واتبع الحالة الظاهرة.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/reports">
              <FileBarChart2 className="ml-2 h-4 w-4" /> التقارير
            </Link>
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {workflow.stages.map((stage) => (
            <WorkflowStageCard key={stage.id} stage={stage} />
          ))}
        </div>
      </section>

      {readiness.isError || scheduleSummary.isError ? (
        <Card className="border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          تعذر تحديث بعض المؤشرات الآن. يمكنك متابعة العمل، لكن راجع صفحة تجهيز البيانات للحصول على
          الفحص التفصيلي.
          <Link to="/data-onboarding" className="mr-2 font-semibold text-primary hover:underline">
            فتح الفحص
          </Link>
        </Card>
      ) : null}

      {user?.isSuperAdmin ? (
        <details className="rounded-xl border border-border bg-card p-4">
          <summary className="cursor-pointer font-semibold">
            إدارة المؤسسة والأدوات الإدارية
          </summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <AdminLink
              to="/universities"
              icon={<Building2 className="h-4 w-4" />}
              title="الجامعة"
              value={organizationStats?.universities}
            />
            <AdminLink
              to="/colleges"
              icon={<School className="h-4 w-4" />}
              title="الكلّيات"
              value={organizationStats?.colleges}
            />
            <AdminLink
              to="/users"
              icon={<Users className="h-4 w-4" />}
              title="المستخدمون"
              value={organizationStats?.users}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function WorkflowStageCard({ stage }: { stage: CoreWorkflowStageState }) {
  return (
    <Link
      to={stage.href}
      className={cn(
        "group rounded-xl border bg-card p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-card)]",
        stage.status === "active" && "border-primary/50 ring-1 ring-primary/15",
        stage.status === "complete" && "border-emerald-500/30",
        stage.status === "blocked" && "opacity-75",
      )}
      data-workflow-stage={stage.id}
      data-status={stage.status}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "grid h-10 w-10 place-items-center rounded-lg bg-secondary text-primary",
            stage.status === "complete" && "bg-emerald-500/10 text-emerald-700",
          )}
        >
          {stage.status === "complete" ? (
            <CheckCircle2 className="h-5 w-5" />
          ) : (
            STAGE_ICONS[stage.id]
          )}
        </span>
        <Badge
          variant={stage.status === "active" ? "default" : "outline"}
          className={cn(stage.status === "complete" && "border-emerald-500/30 text-emerald-700")}
        >
          {stage.statusLabelAr}
        </Badge>
      </div>
      <p className="mt-4 text-xs font-semibold text-muted-foreground">الخطوة {stage.order}</p>
      <h3 className="mt-1 font-bold">{stage.titleAr}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{stage.descriptionAr}</p>
    </Link>
  );
}

function AdminLink({
  to,
  icon,
  title,
  value,
}: {
  to: "/universities" | "/colleges" | "/users";
  icon: React.ReactNode;
  title: string;
  value: number | undefined;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-lg bg-muted/50 p-3 hover:bg-muted"
    >
      <span className="flex items-center gap-2 text-sm font-medium">
        {icon} {title}
      </span>
      <span className="text-sm font-bold">{value ?? "—"}</span>
    </Link>
  );
}
