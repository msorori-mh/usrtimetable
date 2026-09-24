import { supabase } from "@/integrations/supabase/client";
import {
  parseCohortCurriculumSummary,
  type CohortCurriculumSummary,
} from "@/lib/academic-delivery/cohort-curriculum-summary";

export type { CohortCurriculumSummary } from "@/lib/academic-delivery/cohort-curriculum-summary";

/** Explicit cohort-first generation. Legacy registration and section paths are not consulted. */
export async function generateCohortCurriculum(cohortId: string): Promise<CohortCurriculumSummary> {
  if (!cohortId) throw new Error("COHORT_ID_REQUIRED");
  const { data, error } = await supabase.rpc("generate_cohort_curriculum", {
    p_cohort_id: cohortId,
  });
  if (error) throw error;
  return parseCohortCurriculumSummary(data, cohortId);
}
