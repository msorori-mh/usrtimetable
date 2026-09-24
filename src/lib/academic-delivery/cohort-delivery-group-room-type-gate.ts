/**

 * Client-side pre-check before generate_cohort_delivery_groups RPC.

 * Batch-collects all missing/invalid plan component room types for a cohort.

 */

import { supabase } from "@/integrations/supabase/client";

import { resolveCohortCurriculumPlanCourses } from "./cohort-curriculum-plan-courses";

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

  const curriculum = await resolveCohortCurriculumPlanCourses(cohortId);

  if (!curriculum) {
    return {
      ok: false,

      code: "MISSING_ROOM_TYPE_COMPONENTS",

      components: [],
    };
  }

  const { collegeId, programName, levelName, termLabel, planCourses } = curriculum;

  const planCourseIds = planCourses.map((p) => p.id);

  if (planCourseIds.length === 0) {
    return { ok: true };
  }

  const { data: components, error: compError } = await supabase

    .from("plan_course_components")

    .select(
      "id, plan_course_id, component_type, weekly_contact_hours, is_timetabled, explicit_group_size, required_room_type_id, room_types!pcc_room_type_college_fkey(id, college_id, is_active, default_capacity)",
    )

    .eq("college_id", collegeId)

    .in("plan_course_id", planCourseIds);

  if (compError) throw compError;

  const offeringByPlanCourse = new Map(
    planCourses.map((p) => [p.id, { courseCode: p.courseCode, courseName: p.courseName }]),
  );

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

      semester: curriculum.semester,

      roomDefaultCapacity: rt?.default_capacity ?? null,

      roomTypeActive: rt?.is_active ?? null,

      roomTypeCollegeId: rt?.college_id ?? null,
    };
  });

  return collectMissingRoomTypeComponents(rows, {
    collegeId,

    termLabel,
  });
}
