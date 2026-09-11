import { supabase } from "@/integrations/supabase/client";
import { fetchCollegePlanComponentRoomTypeMissing } from "./plan-component-room-type-readiness";
import { studyPlanReadinessMetrics, type ReadinessPlanCourse } from "./study-plan-readiness";

/** Both readiness screens use this scan; query failures must never report a clean plan. */
export async function fetchStudyPlanReadiness(
  collegeId: string,
  courses: { id: string }[],
  plans: ReadinessPlanCourse[],
) {
  const [components, missingRoomTypes] = await Promise.all([
    supabase
      .from("plan_course_components")
      .select("plan_course_id, component_type, weekly_contact_hours, is_timetabled")
      .eq("college_id", collegeId),
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
