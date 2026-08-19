import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ClipboardList, Info, RefreshCw, XCircle } from "lucide-react";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  fetchOnboardingReadinessSnapshot,
  type WizardStepResult,
  type WizardStepStatus,
} from "@/lib/data-onboarding";

export const Route = createFileRoute("/_authenticated/data-onboarding")({
  head: () => ({ meta: [{ title: "إعداد البيانات وإنشاء الجدول" }] }),
  component: DataOnboardingPage,
});

const STATUS_LABEL_AR: Record<WizardStepStatus, string> = {
  complete: "مكتمل",
  incomplete: "غير مكتمل",
  "needs-review": "يحتاج مراجعة",
  warning: "تحذير",
  blocker: "حاجز",
};

function statusTone(status: WizardStepStatus): string {
  switch (status) {
    case "complete":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-500/20";
    case "incomplete":
      return "bg-muted text-muted-foreground border-border";
    case "needs-review":
      return "bg-sky-500/10 text-sky-700 border-sky-500/20";
    case "warning":
      return "bg-amber-500/10 text-amber-700 border-amber-500/20";
    case "blocker":
      return "bg-red-500/10 text-red-700 border-red-500/20";
  }
}

function StatusIcon({ status }: { status: WizardStepStatus }) {
  if (status === "complete") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "blocker") return <XCircle className="h-4 w-4 text-red-600" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  return <Info className="h-4 w-4 text-muted-foreground" />;
}

function StepRow({ step, canManage }: { step: WizardStepResult; canManage: boolean }) {
  return (
    <li
      className="flex flex-col gap-2 border-b border-border/60 py-3 last:border-0 sm:flex-row sm:items-start sm:justify-between"
      data-testid={`onboarding-step-${step.id}`}
      data-status={step.status}
    >
      <div className="flex gap-3">
        <span className="mt-0.5">
          <StatusIcon status={step.status} />
        </span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{step.titleAr}</p>
            <Badge variant="outline" className={statusTone(step.status)}>
              {STATUS_LABEL_AR[step.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{step.helpEli5Ar}</p>
          <p className="mt-1 text-xs text-muted-foreground">{step.detailAr}</p>
        </div>
      </div>
      {step.id === "create_schedule_version" ? (
        <Button asChild variant="outline" size="sm" className="shrink-0">
          <Link to="/schedule-versions">فتح نسخ الجدول</Link>
        </Button>
      ) : canManage && step.status !== "complete" ? (
        <Button asChild variant="secondary" size="sm" className="shrink-0">
          {/* Dynamic fix routes across existing pages */}
          <Link to={step.fixHref as "/programs"}>أصلح الآن</Link>
        </Button>
      ) : step.status !== "complete" ? (
        <Button asChild variant="ghost" size="sm" className="shrink-0">
          <Link to={step.fixHref as "/programs"}>عرض</Link>
        </Button>
      ) : null}
    </li>
  );
}

function DataOnboardingPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();

  const { data, isLoading, isFetching, isError, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["data-onboarding-readiness", active?.id],
    enabled: !!active,
    queryFn: () => fetchOnboardingReadinessSnapshot(active!.id),
  });

  const lastCheck = data?.checkedAt
    ? new Date(data.checkedAt)
    : dataUpdatedAt
      ? new Date(dataUpdatedAt)
      : null;
  const nextStep = data?.steps.find((step) => step.status !== "complete") ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-6" dir="rtl">
      <header className="flex flex-wrap items-start gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <ClipboardList className="h-5 w-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">إعداد البيانات وإنشاء الجدول</h1>
          <p className="text-sm text-muted-foreground">
            معالج جاهزية التدفق الجديد فقط (بدون مسار Legacy) — للقراءة فقط؛ لا يكتب في قاعدة
            البيانات ولا يمس الجداول المنشورة.
          </p>
        </div>
        <CollegeSwitcher />
      </header>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلّية للبدء.</Card>
      ) : isLoading && !data ? (
        <Card className="p-6 text-center text-muted-foreground">جارٍ فحص الجاهزية…</Card>
      ) : isError ? (
        <Card className="p-6 text-destructive" role="alert">
          تعذر فحص الجاهزية: {error instanceof Error ? error.message : "خطأ غير معروف"}
        </Card>
      ) : data ? (
        <>
          <Card className="p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">نسبة اكتمال الخطوات</p>
                <p className="text-3xl font-bold" data-testid="onboarding-percent">
                  {data.percentComplete}%
                </p>
              </div>
              <div className="text-sm text-muted-foreground">
                <p>
                  آخر فحص:{" "}
                  <span data-testid="onboarding-last-check">
                    {lastCheck ? lastCheck.toLocaleString("ar") : "—"}
                  </span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  disabled={isFetching}
                  onClick={() => refetch()}
                  data-testid="onboarding-recheck"
                >
                  <RefreshCw className={`h-4 w-4 ml-1 ${isFetching ? "animate-spin" : ""}`} />
                  إعادة الفحص
                </Button>
              </div>
            </div>
            <Progress value={data.percentComplete} className="h-2" />
            {!canManage ? (
              <p
                className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground"
                data-testid="onboarding-readonly-note"
              >
                صلاحيتك للقراءة فقط: يمكنك متابعة الجاهزية، لكن تشغيل الجدولة وإصلاح البيانات يحتاج
                صلاحية إدارة الكلية.
              </p>
            ) : null}
          </Card>

          <Card
            className="flex flex-col gap-4 border-primary/30 bg-primary/[0.04] p-5 sm:flex-row sm:items-center sm:justify-between"
            data-testid="onboarding-next-action"
          >
            <div>
              <p className="text-xs font-semibold text-primary">الإجراء التالي</p>
              <h2 className="mt-1 text-lg font-bold">
                {nextStep?.titleAr ?? "البيانات جاهزة لإنشاء الجدول"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {nextStep?.helpEli5Ar ?? "انتقل إلى نسخ الجدول ثم افتح مساحة البناء."}
              </p>
            </div>
            <Button asChild className="shrink-0">
              <Link
                to={
                  (nextStep
                    ? nextStep.id === "create_schedule_version"
                      ? "/schedule-versions"
                      : nextStep.fixHref
                    : "/schedule-versions") as "/programs"
                }
              >
                {canManage ? "ابدأ الآن" : "عرض"}
              </Link>
            </Button>
          </Card>

          <details className="rounded-xl border border-border bg-card p-5">
            <summary className="cursor-pointer font-semibold">
              عرض تفاصيل خطوات التجهيز ({data.steps.length})
            </summary>
            <p className="mb-3 mt-2 text-sm text-muted-foreground">
              التفاصيل متاحة عند الحاجة، بينما يبقى الإجراء التالي ظاهرًا في الأعلى.
            </p>
            <ul>
              {data.steps.map((step) => (
                <StepRow key={step.id} step={step} canManage={canManage} />
              ))}
            </ul>
          </details>

          <Card className="p-5 space-y-4" data-testid="onboarding-readiness-dashboard">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">لوحة جاهزية التدفق الجديد</h2>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="destructive">حواجز {data.severityCounts.BLOCKER}</Badge>
                <Badge variant="outline" className="border-amber-500/40 text-amber-700">
                  تحذيرات {data.severityCounts.WARNING}
                </Badge>
                <Badge variant="secondary">معلومات {data.severityCounts.INFO}</Badge>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">
              مبني على <code className="text-xs">fetchCollegeReadiness</code> مع استبعاد مقاييس
              Legacy (عروض المقررات / إسناد V1).
            </p>
            {data.newFlowIssues.filter((i) => i.missing > 0).length === 0 ? (
              <p className="text-sm text-emerald-700">لا توجد مشكلات في مقاييس التدفق الجديد.</p>
            ) : (
              <ul className="space-y-2">
                {data.newFlowIssues
                  .filter((i) => i.missing > 0)
                  .map((issue) => (
                    <li
                      key={issue.label}
                      className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                      data-severity={issue.severity}
                      data-flow={issue.flow}
                    >
                      <div className="flex items-start gap-2">
                        {issue.severity === "BLOCKER" ? (
                          <XCircle className="mt-0.5 h-4 w-4 text-red-600" />
                        ) : issue.severity === "WARNING" ? (
                          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
                        ) : (
                          <Info className="mt-0.5 h-4 w-4 text-muted-foreground" />
                        )}
                        <div>
                          <p className="text-sm font-medium">{issue.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {issue.missing} / {issue.total} · {issue.severity}
                          </p>
                        </div>
                      </div>
                      {issue.fixHref ? (
                        canManage ? (
                          <Button asChild size="sm" variant="secondary">
                            <Link to={issue.fixHref as "/programs"}>أصلح الآن</Link>
                          </Button>
                        ) : (
                          <Button asChild size="sm" variant="ghost">
                            <Link to={issue.fixHref as "/programs"}>عرض</Link>
                          </Button>
                        )
                      ) : null}
                    </li>
                  ))}
              </ul>
            )}
            <div className="flex flex-wrap gap-3 text-sm">
              <Link
                to="/data-readiness"
                className="text-primary underline-offset-4 hover:underline"
              >
                تفاصيل جاهزية البيانات ←
              </Link>
              {canManage ? (
                <Link
                  to="/auto-schedule"
                  className="text-primary underline-offset-4 hover:underline"
                  data-testid="onboarding-auto-schedule-link"
                >
                  الجدولة التلقائية ←
                </Link>
              ) : (
                <span
                  className="text-muted-foreground"
                  data-testid="onboarding-auto-schedule-blocked"
                >
                  الجدولة التلقائية متاحة لمديري الكلية فقط
                </span>
              )}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  );
}
