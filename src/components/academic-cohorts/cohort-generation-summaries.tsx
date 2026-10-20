import type { CohortCurriculumSummary } from "@/lib/academic-delivery/cohort-curriculum";
import type { DeliveryGroupGeneratorSummary } from "@/lib/academic-delivery/delivery-group-generator-summary";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";

/** Result panels of the last curriculum / delivery-group generation (split from academic-cohorts.tsx, L-14). */
export function CohortGenerationSummaries({
  effectiveCohortId,
  lastCurriculumSummary,
  lastSummary,
}: {
  effectiveCohortId: string | null;
  lastCurriculumSummary: (CohortCurriculumSummary & { cohortId: string }) | null;
  lastSummary: (DeliveryGroupGeneratorSummary & { cohortId: string }) | null;
}) {
  return (
    <>
      {lastCurriculumSummary?.cohortId === effectiveCohortId ? (
        <Card className="space-y-2 p-4 text-sm" data-testid="cohort-curriculum-summary">
          <p className="font-medium">
            تم تجهيز مقررات الدفعة من الخطة:{" "}
            <span dir="ltr">
              {lastCurriculumSummary.study_plan_code ?? lastCurriculumSummary.study_plan_id}
            </span>
          </p>
          <p className="text-muted-foreground">
            أضيف {formatNumber(lastCurriculumSummary.inserted_offerings)} · موجود مسبقاً{" "}
            {formatNumber(lastCurriculumSummary.skipped_existing)} · مقررات اختيارية معتمدة{" "}
            {formatNumber(lastCurriculumSummary.elective_candidates)}
          </p>
          {lastCurriculumSummary.skipped_unselected_elective > 0 ? (
            <p className="text-amber-700 dark:text-amber-400">
              لم تُنشأ مقررات {formatNumber(lastCurriculumSummary.skipped_unselected_elective)} من
              الخانات الاختيارية لعدم وجود اختيار معتمد للدفعة.
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            لم يُنشأ تسجيل فردي قديم أو مجموعة تشغيلية أو مجموعة محاضرات ومعامل أو جلسة.
          </p>
        </Card>
      ) : null}

      {lastSummary?.cohortId === effectiveCohortId ? (
        <Card className="space-y-2 p-4 text-sm" data-testid="generator-summary-panel">
          {lastSummary.curriculum && (
            <p>
              الخطة المستخدمة:{" "}
              <strong dir="ltr">
                {lastSummary.curriculum.study_plan_code ?? lastSummary.curriculum.study_plan_id}
              </strong>{" "}
              · المقررات:{" "}
              {lastSummary.curriculum.inserted_offerings + lastSummary.curriculum.skipped_existing}
            </p>
          )}
          <p className="font-medium">
            نتيجة التوليد:{" "}
            {
              {
                SUCCESS: "اكتمل",
                NO_CHANGES: "لا توجد تغييرات",
                VALIDATION_FAILED: "يلزم تصحيح البيانات",
                PARTIAL: "اكتمل جزئيًا",
              }[lastSummary.status]
            }
          </p>
          <p className="text-muted-foreground">
            إنشاء {formatNumber(lastSummary.groups_created)} · تحديث{" "}
            {formatNumber(lastSummary.groups_updated)} · دون تغيير{" "}
            {formatNumber(lastSummary.groups_unchanged)} · متوقفة عن الاستخدام{" "}
            {formatNumber(lastSummary.groups_obsolete)}
          </p>
          {(lastSummary.validation_errors?.length ?? 0) > 0 ? (
            <ul className="list-disc ps-5 text-destructive">
              {lastSummary.validation_errors.map((e, i) => (
                <li key={`${e.code}-${i}`}>
                  {e.code}
                  {e.message ? `: ${e.message}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {(lastSummary.warnings?.length ?? 0) > 0 ? (
            <ul className="list-disc ps-5 text-amber-700 dark:text-amber-400">
              {lastSummary.warnings.map((w, i) => (
                <li key={`${w.code}-${i}`}>
                  {w.code}
                  {w.message ? `: ${w.message}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}
