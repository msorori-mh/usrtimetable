import { supabase } from "@/integrations/supabase/client";
import {
  collectPlanComponentRoomTypeIssues,
  type PlanComponentReadinessRow,
  type PlanComponentRoomTypeIssue,
} from "./plan-component-room-types";

export type CohortRoomTypeGate =
  | { ok: true; issues: [] }
  | { ok: false; code: "MISSING_ROOM_TYPE_COMPONENTS"; issues: PlanComponentRoomTypeIssue[] };

/**
 * Read-only mirror of the generator's offering/component selection. It runs before
 * resolve_scheduling_headcount and before generate_cohort_delivery_groups.
 */
export async function checkCohortRoomTypeGate(cohortId: string): Promise<CohortRoomTypeGate> {
  const { data: cohort, error: cohortError } = await supabase
    .from("academic_cohorts")
    .select("college_id, program_id, level_id, term_id, study_system")
    .eq("id", cohortId)
    .maybeSingle();
  if (cohortError) throw cohortError;
  if (!cohort) throw new Error("COHORT_NOT_FOUND");

  const { data: offerings, error: offeringError } = await supabase
    .from("course_offerings")
    .select("plan_course_id, program_id, level_id")
    .eq("college_id", cohort.college_id)
    .eq("term_id", cohort.term_id)
    .eq("study_system", cohort.study_system)
    .eq("is_active", true);
  if (offeringError) throw offeringError;
  const applicableOfferings = (offerings ?? []).filter(
    (row) =>
      (row.program_id ?? cohort.program_id) === cohort.program_id &&
      (row.level_id ?? cohort.level_id) === cohort.level_id,
  );
  const planCourseIds = [
    ...new Set(applicableOfferings.map((row) => row.plan_course_id).filter(Boolean)),
  ] as string[];
  if (planCourseIds.length === 0) return { ok: true, issues: [] };

  const { data: components, error: componentError } = await supabase
    .from("plan_course_components")
    .select(
      "id, college_id, plan_course_id, component_type, weekly_contact_hours, is_timetabled, required_room_type_id",
    )
    .eq("college_id", cohort.college_id)
    .in("plan_course_id", planCourseIds);
  if (componentError) throw componentError;

  const summerScheduled = (components ?? []).filter(
    (row) =>
      row.component_type === "summer_training" &&
      row.is_timetabled &&
      Number(row.weekly_contact_hours) > 0,
  );
  if (summerScheduled.length > 0) {
    throw new Error(
      `SUMMER_TRAINING_ROOM_POLICY_REQUIRED: ${summerScheduled.map((row) => row.id).join(",")}`,
    );
  }

  const roomTypeIds = [
    ...new Set((components ?? []).map((row) => row.required_room_type_id).filter(Boolean)),
  ] as string[];
  const { data: roomTypes, error: roomTypeError } =
    roomTypeIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("room_types")
          .select("id, code, college_id, is_active, default_capacity")
          .in("id", roomTypeIds);
  if (roomTypeError) throw roomTypeError;
  const roomTypeById = new Map((roomTypes ?? []).map((row) => [row.id, row]));

  // Context labels are deliberately complete identifiers when display joins are
  // unavailable; the UI never truncates the resulting issue list.
  const rows: PlanComponentReadinessRow[] = (components ?? []).map((component) => {
    const roomType = component.required_room_type_id
      ? roomTypeById.get(component.required_room_type_id)
      : null;
    return {
      college_code: cohort.college_id,
      college_id: cohort.college_id,
      program_code: cohort.program_id,
      study_plan_id: component.plan_course_id,
      level_number: 0,
      semester: 0,
      course_code: component.plan_course_id,
      course_name: component.plan_course_id,
      component_type: component.component_type as PlanComponentReadinessRow["component_type"],
      component_hours: Number(component.weekly_contact_hours),
      is_timetabled: component.is_timetabled,
      room_type_id: component.required_room_type_id,
      room_type_code: roomType?.code ?? null,
      room_type_college_id: roomType?.college_id ?? null,
      room_type_active: roomType?.is_active ?? null,
      room_type_capacity: roomType?.default_capacity ?? null,
    };
  });
  const issues = collectPlanComponentRoomTypeIssues(rows);
  return issues.length === 0
    ? { ok: true, issues: [] }
    : { ok: false, code: "MISSING_ROOM_TYPE_COMPONENTS", issues };
}
