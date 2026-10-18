import { supabase } from "@/integrations/supabase/client";
import { fetchCollegePlanComponentRoomTypeMissing } from "./plan-component-room-type-readiness";
import {
  studyPlanReadinessMetrics,
  type ReadinessPlanComponent,
  type ReadinessPlanCourse,
} from "./study-plan-readiness";
import { readAllRows } from "@/lib/supabase/read-all";

/** Both readiness screens use this scan; query failures must never report a clean plan. */
export async function fetchStudyPlanReadiness(
  collegeId: string,
  courses: { id: string }[],
  plans: ReadinessPlanCourse[],
) {
  // H-10: college-wide scan, paginated so a large college is never scored on a 1000-row prefix.
  const readComponents = async () => {
    try {
      const data = await readAllRows<ReadinessPlanComponent & { id: string }>((from, to) =>
        supabase
          .from("plan_course_components")
          .select("id, plan_course_id, component_type, weekly_contact_hours, is_timetabled")
          .eq("college_id", collegeId)
          .order("id")
          .range(from, to),
      );
      return { data, error: null as { message: string } | null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  };
  const [components, missingRoomTypes] = await Promise.all([
    readComponents(),
    fetchCollegePlanComponentRoomTypeMissing(collegeId),
  ]);
  if (components.error)
    throw new Error(`READINESS_QUERY_FAILED[plan_course_components]: ${components.error.message}`);
  return {
    metrics: studyPlanReadinessMetrics(
      courses,
      plans,
      components.data ?? [],
      missingRoomTypes.length,
    ),
    missingRoomTypes,
  };
}
