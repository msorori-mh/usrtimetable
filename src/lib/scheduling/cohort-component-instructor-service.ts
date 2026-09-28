import { supabase } from "@/integrations/supabase/client";
import {
  parseCohortComponentInstructorReadiness,
  type CohortComponentInstructorReadiness,
} from "./cohort-component-instructor";

type ReadinessRpcClient = {
  rpc: (
    fn: "get_cohort_component_instructor_readiness",
    args: { p_college_id: string; p_schedule_version_id: string },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Read-only server preflight; no assignments or sessions are changed. */
export async function getCohortComponentInstructorReadiness(input: {
  collegeId: string;
  scheduleVersionId: string;
}): Promise<CohortComponentInstructorReadiness> {
  const { data, error } = await (supabase as unknown as ReadinessRpcClient).rpc(
    "get_cohort_component_instructor_readiness",
    {
      p_college_id: input.collegeId,
      p_schedule_version_id: input.scheduleVersionId,
    },
  );
  if (error) {
    throw new Error(`COHORT_COMPONENT_INSTRUCTOR_READINESS_FAILED: ${error.message}`);
  }
  return parseCohortComponentInstructorReadiness(data);
}
