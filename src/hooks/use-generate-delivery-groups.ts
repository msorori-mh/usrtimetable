import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  generateCohortDeliveryGroups,
  type DeliveryGroupGeneratorSummary,
} from "@/lib/academic-delivery/generate-delivery-groups";

/** Explicit, user-triggered generation only — never auto-run after import. */
export function useGenerateDeliveryGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cohortId: string) => generateCohortDeliveryGroups(cohortId),
    onSuccess: (summary: DeliveryGroupGeneratorSummary) => {
      void qc.invalidateQueries({ queryKey: ["delivery-groups"] });
      void qc.invalidateQueries({ queryKey: ["academic-cohorts"] });
      const errs = summary.validation_errors?.length ?? 0;
      const warns = summary.warnings?.length ?? 0;
      toast.success(
        `توليد المجموعات: إنشاء ${summary.groups_created} · تحديث ${summary.groups_updated}` +
          (errs ? ` · أخطاء تحقق ${errs}` : "") +
          (warns ? ` · تحذيرات ${warns}` : ""),
      );
    },
    onError: (e: Error) => {
      toast.error(e.message || "فشل توليد مجموعات التدريس");
    },
  });
}
