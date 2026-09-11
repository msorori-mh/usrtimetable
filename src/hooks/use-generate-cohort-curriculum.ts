import { generationErrorMessage } from "@/lib/academic-delivery/generation-messages";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { generateCohortCurriculum } from "@/lib/academic-delivery/cohort-curriculum";

/** User-triggered only: approved plan + approved cohort electives become cohort offerings. */
export function useGenerateCohortCurriculum() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateCohortCurriculum,
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: ["course-offerings"] });
      void queryClient.invalidateQueries({ queryKey: ["academic-cohorts"] });
      if (summary.skipped_unselected_elective > 0) {
        toast.warning(
          `تم تجهيز المقررات المتاحة؛ تبقى ${summary.skipped_unselected_elective} خانة اختيارية بحاجة إلى تحديد مقرر واعتماده.`,
        );
      } else if (summary.inserted_offerings === 0) {
        toast.message(
          `مقررات الدفعة جاهزة مسبقًا (${summary.skipped_existing} مقرر). يمكنك توليد المجموعات.`,
        );
      } else {
        toast.success(`تم توليد ${summary.inserted_offerings} من مقررات الدفعة.`);
      }
    },
    onError: (error: Error) => toast.error(generationErrorMessage(error)),
  });
}
