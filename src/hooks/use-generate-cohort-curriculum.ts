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
          `${summary.skipped_unselected_elective} elective slot(s) await approved cohort selection.`,
        );
      } else if (summary.inserted_offerings === 0) {
        toast.message("Cohort curriculum is already current.");
      } else {
        toast.success(`تم توليد ${summary.inserted_offerings} من مقررات الدفعة.`);
      }
    },
    onError: (error: Error) => toast.error(error.message || "Cohort curriculum generation failed."),
  });
}
