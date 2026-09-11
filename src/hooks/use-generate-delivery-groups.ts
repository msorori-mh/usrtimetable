import { generationErrorMessage } from "@/lib/academic-delivery/generation-messages";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  generateCohortDeliveryGroups,
  DeliveryGroupRoomTypeGateError,
  type DeliveryGroupGeneratorSummary,
} from "@/lib/academic-delivery/generate-delivery-groups";
import { isGeneratorSuccessStatus } from "@/lib/academic-delivery/delivery-group-generator-summary";

/** Explicit, user-triggered generation only — never auto-run after import. */
export function useGenerateDeliveryGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cohortId: string) => generateCohortDeliveryGroups(cohortId),
    onSuccess: (summary: DeliveryGroupGeneratorSummary) => {
      void qc.invalidateQueries({ queryKey: ["course-offerings"] });
      void qc.invalidateQueries({ queryKey: ["cohort-dg-room-type-gate"] });
      void qc.invalidateQueries({ queryKey: ["delivery-groups"] });
      void qc.invalidateQueries({ queryKey: ["academic-cohorts"] });

      const errs = summary.validation_errors?.length ?? 0;
      const warns = summary.warnings?.length ?? 0;
      const success = isGeneratorSuccessStatus(summary.status) && errs === 0;

      if (!success) {
        toast.error(
          summary.status === "VALIDATION_FAILED" || errs > 0
            ? `فشل التحقق من التوليد (${errs} خطأ). لم تُنشأ مجموعات جزئية.`
            : `توليد المجموعات لم يكتمل (الحالة: ${summary.status})`,
        );
        return;
      }

      if (summary.status === "NO_CHANGES") {
        toast.message(`لا تغييرات على مجموعات التدريس` + (warns ? ` · تحذيرات ${warns}` : ""));
      } else {
        toast.success(
          `توليد المجموعات: إنشاء ${summary.groups_created} · تحديث ${summary.groups_updated}` +
            (warns ? ` · تحذيرات ${warns}` : ""),
        );
      }

      if (warns > 0) {
        toast.warning(`تحذيرات التوليد: ${warns}`);
      }
    },
    onError: (e: Error) => {
      if (e instanceof DeliveryGroupRoomTypeGateError && !e.gate.ok) {
        toast.error(
          `MISSING_ROOM_TYPE_COMPONENTS: ${e.gate.components.length} مكوّن(ات) بدون نوع قاعة صالح`,
        );
        return;
      }
      toast.error(generationErrorMessage(e));
    },
  });
}

