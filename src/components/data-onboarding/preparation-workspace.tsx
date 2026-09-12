import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  ArrowLeft,
  BookOpen,
  FileSpreadsheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { TEMPLATES } from "@/lib/excel-import/templates";
import type { ImportEntity } from "@/lib/excel-import/types";
import type { OnboardingReadinessSnapshot } from "@/lib/data-onboarding/snapshot";
import {
  PREPARATION_STEPS,
  preparationEntities,
  preparationLabel,
  resolvePreparationProgress,
  type PreparationStepId,
} from "@/lib/data-onboarding/preparation";
import type { WizardStepStatus } from "@/lib/data-onboarding/types";
import { roomTimeCapacityMessagesAr } from "@/lib/reports/room-time-capacity";

const STATUS: Record<WizardStepStatus, string> = {
  complete: "مكتمل",
  incomplete: "يلزم التجهيز",
  blocker: "يلزم التصحيح",
  warning: "يحتاج مراجعة",
  "needs-review": "يحتاج مراجعة",
};

export function PreparationWorkspace({
  snapshot,
  selectedStep,
  selectedEntity,
  showHelp,
  canManage,
  refreshing,
  onSelect,
  importer,
}: {
  snapshot: OnboardingReadinessSnapshot;
  selectedStep: PreparationStepId;
  selectedEntity?: ImportEntity;
  showHelp?: boolean;
  canManage: boolean;
  refreshing: boolean;
  onSelect: (step: PreparationStepId, entity?: ImportEntity, help?: boolean) => void;
  importer?: ReactNode;
}) {
  const progress = resolvePreparationProgress(snapshot.steps);
  const step = PREPARATION_STEPS.find((s) => s.id === selectedStep) ?? PREPARATION_STEPS[0];
  const index = PREPARATION_STEPS.indexOf(step);
  const result = progress.steps.find((s) => s.id === step.id);
  const status = result?.status ?? "incomplete";
  const entities = preparationEntities(step.id, snapshot.hasElectives);
  const guideEntity = selectedEntity ?? entities[0];
  const template = guideEntity ? TEMPLATES[guideEntity] : undefined;
  const issues = snapshot.newFlowIssues.filter((issue) => issue.missing > 0);
  const capacity = snapshot.readiness.roomTimeCapacity;
  const capacityMessages =
    capacity && (capacity.unavailable || capacity.insufficient.length > 0)
      ? roomTimeCapacityMessagesAr(capacity)
      : [];
  return (
    <div className="space-y-5" data-testid="preparation-workspace">
      {!canManage && (
        <p className="rounded-lg bg-muted p-3 text-sm" data-testid="onboarding-readonly-note">
          صلاحيتك للقراءة فقط. يمكنك متابعة التجهيز والاطلاع على البيانات؛ الاستيراد والتعديل وتشغيل
          الجدولة متاح لمديري الكلية فقط.
        </p>
      )}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">تجهيز بيانات الكلية</p>
            <p className="mt-1 text-xl font-bold">
              {progress.complete} من {progress.total} خطوات مكتملة
            </p>
          </div>
          <span className="text-2xl font-bold text-primary" data-testid="onboarding-percent">
            {progress.percent}%
          </span>
        </div>
        <Progress value={progress.percent} className="mt-3 h-2" />
        <p className="mt-3 text-xs text-muted-foreground">
          يشمل الفحص بيانات الكلية في جميع الفصول. اختر الفصل المطلوب عند إنشاء الجدول.
        </p>
      </Card>
      <Card
        className="flex flex-wrap items-center justify-between gap-3 border-primary/25 bg-primary/[0.04] p-4"
        data-testid="onboarding-next-action"
      >
        <div>
          <p className="text-xs font-semibold text-primary">الخطوة التالية</p>
          <p className="mt-1 font-semibold">
            {progress.percent === 100
              ? "بيانات الكلية جاهزة للانتقال إلى الجدول"
              : PREPARATION_STEPS.find((s) => s.id === progress.nextStepId)?.title}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => onSelect(progress.nextStepId)}
          disabled={refreshing}
        >
          عرض الخطوة
        </Button>
      </Card>
      <div className="grid items-start gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav
          aria-label="خطوات تجهيز البيانات"
          className="flex gap-2 overflow-x-auto pb-2 lg:block lg:space-y-2 lg:overflow-visible"
        >
          {PREPARATION_STEPS.map((s, i) => {
            const state = progress.steps.find((v) => v.id === s.id)?.status ?? "incomplete";
            const current = s.id === step.id;
            const Icon =
              state === "complete" ? CheckCircle2 : state === "blocker" ? AlertCircle : Circle;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={current ? "step" : undefined}
                onClick={() => onSelect(s.id)}
                data-testid={`onboarding-step-${s.id}`}
                data-status={state}
                className={`flex min-w-[13rem] items-start gap-3 rounded-lg border p-3 text-right lg:w-full lg:min-w-0 ${current ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/50"}`}
              >
                <span className="mt-0.5 text-sm text-muted-foreground">{i + 1}</span>
                <span className="flex-1">
                  <span className="block text-sm font-semibold">{s.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">{STATUS[state]}</span>
                </span>
                <Icon
                  className={`mt-0.5 h-4 w-4 shrink-0 ${state === "complete" ? "text-emerald-600" : state === "blocker" ? "text-destructive" : "text-muted-foreground"}`}
                />
              </button>
            );
          })}
        </nav>
        <section className="min-w-0 space-y-4" aria-label={step.title}>
          <Card className="space-y-4 p-5" data-testid="preparation-current-step">
            <div>
              <p className="text-xs text-muted-foreground">
                الخطوة {index + 1} من {progress.total}
              </p>
              <h2 className="mt-1 text-xl font-bold">{step.title}</h2>
              <p className="mt-2 text-sm leading-7 text-muted-foreground">{step.description}</p>
            </div>
            <div
              className={`rounded-lg border p-3 text-sm ${status === "complete" ? "border-emerald-500/25 bg-emerald-50/30" : "bg-muted/30"}`}
              role="status"
            >
              <p className="font-semibold">{STATUS[status]}</p>
              <p className="mt-1">
                {preparationLabel(result?.detailAr ?? "لم يكتمل فحص هذه الخطوة.")}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {canManage && entities.length > 0 && (
                <Button onClick={() => onSelect(step.id, entities[0])}>
                  <FileSpreadsheet className="h-4 w-4" /> تجهيز ورفع ملف Excel
                </Button>
              )}
              {step.manualLinks.map((link) => (
                <Button key={link.href} asChild variant="outline">
                  <Link to={link.href as "/programs"}>
                    {canManage
                      ? link.label
                      : link.label.replace(/إدارة|توليد|اعتماد|تحديد/g, "عرض")}
                  </Link>
                </Button>
              ))}
              {template && (
                <Button
                  variant="ghost"
                  onClick={() => onSelect(step.id, selectedEntity, !showHelp)}
                >
                  <BookOpen className="h-4 w-4" /> شرح الحقول
                </Button>
              )}
            </div>
            {step.id === "academic_structure" && (
              <p className="text-xs text-muted-foreground">
                تُضاف الأقسام والبرامج من أزرار الإدارة أعلاه. استيراد Excel في هذه الخطوة مخصص
                للفصول الأكاديمية.
              </p>
            )}
            {step.id === "delivery_groups" && (
              <p className="text-xs text-muted-foreground">
                جهّز الخطة والدفعات وأعداد الطلاب والقاعات أولًا، ثم افتح توليد المجموعات.
              </p>
            )}
            {showHelp && template && (
              <div
                className="overflow-x-auto rounded-md border"
                data-testid="preparation-field-guide"
              >
                <table className="w-full text-sm">
                  <caption className="p-3 text-right font-semibold">
                    حقول قالب {preparationLabel(template.label)}
                  </caption>
                  <thead className="bg-muted">
                    <tr>
                      <th className="p-2 text-right">الحقل</th>
                      <th className="p-2 text-right">مطلوب؟</th>
                      <th className="p-2 text-right">مثال / قيم مقبولة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {template.columns.map((c) => (
                      <tr key={c.key} className="border-t">
                        <td className="p-2">{c.header}</td>
                        <td className="p-2">{c.required ? "نعم" : "اختياري"}</td>
                        <td className="p-2">{c.enumValues?.join("، ") || c.example || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {canManage && selectedEntity && importer}
          {capacityMessages.length > 0 && (
            <Card
              className="space-y-2 border-destructive/40 bg-destructive/5 p-5"
              role="alert"
              data-testid="room-time-capacity-blocker"
            >
              <h3 className="font-semibold text-destructive">
                السعة الزمنية الأسبوعية للقاعات غير كافية — لا يمكن اعتبار التجهيز مكتملاً
              </h3>
              <ul className="space-y-1 text-sm">
                {capacityMessages.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground">
                الحل: إضافة قاعات من النوع نفسه، أو تقليل الساعات المطلوبة. لم يتم تغيير ساعات
                الدوام ولا افتراض أي قاعة غير مسجلة.
              </p>
            </Card>
          )}
          {step.id === "readiness_check" && (
            <Card className="space-y-3 p-5" data-testid="onboarding-readiness-dashboard">
              <h3 className="font-semibold">ما الذي يحتاج إلى استكمال؟</h3>
              {issues.length === 0 ? (
                <p className="text-sm text-emerald-700">
                  لم يظهر نقص في فحوص البيانات الحالية. راجع اكتمال خطوات التجهيز أعلاه.
                </p>
              ) : (
                <ul className="space-y-3">
                  {issues.map((issue) => (
                    <li
                      key={issue.label}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                    >
                      <div>
                        <p className="text-sm font-medium">{preparationLabel(issue.label)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          يلزم استكمال {issue.missing} من {issue.total} ·{" "}
                          {issue.severity === "BLOCKER" ? "يلزم التصحيح" : "يحتاج مراجعة"}
                        </p>
                      </div>
                      {issue.fixHref && (
                        <Button variant="outline" size="sm" asChild>
                          {issue.fixSearch ? (
                            <Link to="/instructors" search={issue.fixSearch}>
                              {canManage ? "أصلح الآن" : "عرض البيانات"}
                            </Link>
                          ) : (
                            <Link to={issue.fixHref as "/programs"}>
                              {canManage ? "أصلح الآن" : "عرض البيانات"}
                            </Link>
                          )}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <div className="flex flex-wrap justify-between gap-3">
            <Button
              variant="ghost"
              disabled={index === 0}
              onClick={() => onSelect(PREPARATION_STEPS[index - 1].id)}
            >
              الخطوة السابقة
            </Button>
            {index < PREPARATION_STEPS.length - 1 ? (
              <Button variant="outline" onClick={() => onSelect(PREPARATION_STEPS[index + 1].id)}>
                الخطوة التالية <ArrowLeft className="h-4 w-4" />
              </Button>
            ) : canManage ? (
              progress.canContinue && !refreshing ? (
                <Button asChild>
                  <Link to="/schedule-versions">الانتقال إلى إنشاء الجدول</Link>
                </Button>
              ) : (
                <Button disabled>استكمل النواقص قبل إنشاء الجدول</Button>
              )
            ) : (
              <p
                className="text-sm text-muted-foreground"
                data-testid="onboarding-auto-schedule-blocked"
              >
                إنشاء الجدول متاح لمديري الكلية فقط.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
