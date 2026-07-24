/**
 * Read-only college-wide scan for PLAN_COMPONENT_ROOM_TYPE_MISSING blocker.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  collectMissingRoomTypeComponents,
  PLAN_COMPONENT_ROOM_TYPE_MISSING_BLOCKER,
  type CohortPlanComponentRow,
  type MissingRoomTypeComponent,
} from "./plan-component-room-types";

export { PLAN_COMPONENT_ROOM_TYPE_MISSING_BLOCKER };
export type { MissingRoomTypeComponent };

export async function fetchCollegePlanComponentRoomTypeMissing(
  collegeId: string,
): Promise<MissingRoomTypeComponent[]> {
  const { data, error } = await supabase
    .from("plan_course_components")
    .select(
      `
      id,
      component_type,
      weekly_contact_hours,
      is_timetabled,
      explicit_group_size,
      required_room_type_id,
      college_id,
      plan_courses(
        semester,
        courses(code, name),
        academic_levels(name),
        study_plans(academic_programs(name))
      ),
      room_types(id, college_id, is_active, default_capacity)
    `,
    )
    .eq("college_id", collegeId);

  if (error) throw error;

  const rows: CohortPlanComponentRow[] = (data ?? []).map((pcc) => {
    const pc = pcc.plan_courses as {
      semester?: number;
      courses?: { code?: string; name?: string } | null;
      academic_levels?: { name?: string } | null;
      study_plans?: {
        academic_programs?: { name?: string } | null;
      } | null;
    } | null;
    const rt = pcc.room_types as {
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
      courseCode: pc?.courses?.code ?? "—",
      courseName: pc?.courses?.name ?? "—",
      programName: pc?.study_plans?.academic_programs?.name ?? "—",
      levelName: pc?.academic_levels?.name ?? "—",
      semester: pc?.semester ?? 0,
      roomDefaultCapacity: rt?.default_capacity ?? null,
      roomTypeActive: rt?.is_active ?? null,
      roomTypeCollegeId: rt?.college_id ?? null,
    };
  });

  const gate = collectMissingRoomTypeComponents(rows, {
    collegeId,
    termLabel: "—",
  });
  if (gate.ok) return [];
  return gate.components.map((c) => ({
    ...c,
    term:
      c.term === "—"
        ? `فصل ${rows.find((r) => r.componentId === c.componentId)?.semester ?? "—"}`
        : c.term,
  }));
}
