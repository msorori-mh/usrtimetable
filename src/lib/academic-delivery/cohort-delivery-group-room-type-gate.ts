/**
 * Client-side pre-check before generate_cohort_delivery_groups RPC.
 * Batch-collects all missing/invalid plan component room types for a cohort.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  collectMissingRoomTypeComponents,
  type CohortPlanComponentRow,
  type MissingRoomTypeGateResult,
} from "./plan-component-room-types";

export type { MissingRoomTypeGateResult };

export async function checkCohortDeliveryGroupRoomTypes(
  cohortId: string,
): Promise<MissingRoomTypeGateResult> {
  if (!cohortId) {
    return {
      ok: false,
      code: "MISSING_ROOM_TYPE_COMPONENTS",
      components: [],
    };
  }

  const { data: cohort, error: cohortError } = await supabase
    .from("academic_cohorts")
    .select(
      "id, college_id, program_id, level_id, term_id, study_system, academic_programs!ac_program_college_fkey(name), academic_levels!ac_level_college_fkey(name), academic_terms!ac_term_college_fkey(name)",
    )
    .eq("id", cohortId)
    .maybeSingle();

  if (cohortError) throw cohortError;
  if (!cohort) {
    return {
      ok: false,
      code: "MISSING_ROOM_TYPE_COMPONENTS",
      components: [],
    };
  }

  const programName = (cohort.academic_programs as { name?: string } | null)?.name ?? "—";
  const levelName = (cohort.academic_levels as { name?: string } | null)?.name ?? "—";
  const termLabel = (cohort.academic_terms as { name?: string } | null)?.name ?? "—";

  const { data: offerings, error: offError } = await supabase
    .from("course_offerings")
    .select("id, plan_course_id, course_id, courses(code, name), plan_courses(id, study_plan_id)")
    .eq("college_id", cohort.college_id)
    .eq("term_id", cohort.term_id)
    .eq("program_id", cohort.program_id)
    .eq("level_id", cohort.level_id)
    .eq("study_system", cohort.study_system)
    .not("plan_course_id", "is", null)
    .eq("is_active", true);

  if (offError) throw offError;

  const planCourseIds = [
    ...new Set(
      (offerings ?? [])
        .map((o) => o.plan_course_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];

  if (planCourseIds.length === 0) {
    return { ok: true };
  }

  const { data: components, error: compError } = await supabase
    .from("plan_course_components")
    .select(
      "id, plan_course_id, component_type, weekly_contact_hours, is_timetabled, explicit_group_size, required_room_type_id, room_types!pcc_room_type_college_fkey(id, college_id, is_active, default_capacity)",
    )
    .eq("college_id", cohort.college_id)
    .in("plan_course_id", planCourseIds);

  if (compError) throw compError;

  const offeringByPlanCourse = new Map<string, { courseCode: string; courseName: string }>();
  for (const o of offerings ?? []) {
    if (!o.plan_course_id) continue;
    const course = o.courses as { code?: string; name?: string } | null;
    offeringByPlanCourse.set(o.plan_course_id, {
      courseCode: course?.code ?? "—",
      courseName: course?.name ?? "—",
    });
  }

  const rows: CohortPlanComponentRow[] = (components ?? []).map((pcc) => {
    const meta = offeringByPlanCourse.get(pcc.plan_course_id) ?? {
      courseCode: "—",
      courseName: "—",
    };
    const rt = pcc.room_types as {
      id?: string;
      college_id?: string;
      is_active?: boolean;
      default_capacity?: number;
    } | null;
    return {
      componentId: pcc.id,
      componentType: pcc.component_type as CohortPlanComponentRow["componentType"],
      weeklyContactHours: Number(pcc.weekly_contact_hours ?? 0),
      isTimetabled: pcc.is_timetabled !== false,
      explicitGroupSize: pcc.explicit_group_size,
      requiredRoomTypeId: pcc.required_room_type_id,
      courseCode: meta.courseCode,
      courseName: meta.courseName,
      programName,
      levelName,
      semester: 0,
      roomDefaultCapacity: rt?.default_capacity ?? null,
      roomTypeActive: rt?.is_active ?? null,
      roomTypeCollegeId: rt?.college_id ?? null,
    };
  });

  return collectMissingRoomTypeComponents(rows, {
    collegeId: cohort.college_id,
    termLabel,
  });
}
