/**
 * ROOM-TIME-CAPACITY-READINESS-01 — read-only data fetch for the weekly
 * room-hours capacity check. Fail closed: any query error surfaces as an
 * "unavailable" analysis (a blocker), never as a silent pass.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  analyzeRoomTimeCapacity,
  type RoomTimeCapacityAnalysis,
  type TimeCapacityDemand,
  type TimeCapacityRoom,
  type TimeCapacityRoomType,
} from "./room-time-capacity";

export async function fetchRoomTimeCapacity(
  collegeId: string,
  rooms: TimeCapacityRoom[],
  roomTypes: TimeCapacityRoomType[],
): Promise<RoomTimeCapacityAnalysis> {
  try {
    const [settings, roomAvailability, terms, cohorts, groups, assignments, components] =
      await Promise.all([
        supabase
          .from("scheduling_settings")
          .select("working_days, day_start_time, day_end_time")
          .eq("college_id", collegeId)
          .maybeSingle(),
        supabase
          .from("room_availability")
          .select("room_id, day_of_week, start_time, end_time")
          .eq("college_id", collegeId),
        supabase
          .from("academic_terms")
          .select("id, is_active")
          .eq("college_id", collegeId)
          .eq("is_active", true),
        supabase.from("academic_cohorts").select("id, term_id, active").eq("college_id", collegeId),
        supabase
          .from("operational_delivery_groups")
          .select("id, cohort_id, active, is_obsolete")
          .eq("college_id", collegeId),
        supabase
          .from("teaching_assignments")
          .select(
            "id, delivery_group_id, plan_course_component_id, required_room_type, weekly_hours, assigned_component_hours, is_active",
          )
          .eq("college_id", collegeId)
          .not("delivery_group_id", "is", null),
        supabase
          .from("plan_course_components")
          .select("id, required_room_type_id, component_type")
          .eq("college_id", collegeId),
      ]);

    const error =
      settings.error ||
      roomAvailability.error ||
      terms.error ||
      cohorts.error ||
      groups.error ||
      assignments.error ||
      components.error;
    if (error) throw new Error(error.message);

    const activeTermIds = new Set((terms.data ?? []).map((t) => t.id));
    const termCohortIds = new Set(
      (cohorts.data ?? [])
        .filter(
          (c) => c.active !== false && (activeTermIds.size === 0 || activeTermIds.has(c.term_id)),
        )
        .map((c) => c.id),
    );
    const eligibleGroups = new Set(
      (groups.data ?? [])
        .filter(
          (g) => g.active !== false && g.is_obsolete !== true && termCohortIds.has(g.cohort_id),
        )
        .map((g) => g.id),
    );
    const componentRoomType = new Map(
      (components.data ?? []).map((c) => [c.id, c.required_room_type_id] as const),
    );
    // Component type decides whether lab demand may use the lecture-hall
    // fallback when pooling weekly capacity (same policy as the scheduler).
    const componentType = new Map(
      (components.data ?? []).map(
        (c) => [c.id, (c as { component_type?: string | null }).component_type ?? null] as const,
      ),
    );
    const typeByCode = new Map(
      roomTypes.map((t) => [
        String((t as { code?: string | null }).code ?? "").toLowerCase(),
        t.id,
      ]),
    );

    const demand: TimeCapacityDemand[] = (assignments.data ?? [])
      .filter(
        (a) =>
          a.is_active !== false && a.delivery_group_id && eligibleGroups.has(a.delivery_group_id),
      )
      .map((a) => {
        const fromComponent = a.plan_course_component_id
          ? componentRoomType.get(a.plan_course_component_id)
          : null;
        const fromCode = a.required_room_type
          ? typeByCode.get(String(a.required_room_type).toLowerCase())
          : null;
        return {
          roomTypeId: fromComponent ?? fromCode ?? null,
          hours: Number(a.assigned_component_hours ?? a.weekly_hours ?? 0),
          componentType: a.plan_course_component_id
            ? (componentType.get(a.plan_course_component_id) ?? null)
            : null,
        };
      });

    return analyzeRoomTimeCapacity({
      settings: settings.data ?? null,
      rooms,
      roomTypes,
      roomAvailability: roomAvailability.data ?? [],
      demand,
    });
  } catch (e) {
    return {
      unavailable: true,
      unavailableReasonAr: `تعذر حساب السعة الزمنية للقاعات — أُوقف الانتقال احترازيًا: ${
        e instanceof Error ? e.message : "خطأ استعلام غير معروف"
      }`,
      workingDays: [],
      dailyHours: 0,
      perType: [],
      insufficient: [],
      unresolvedHours: 0,
      totalRequiredHours: 0,
      totalAvailableHours: 0,
    };
  }
}
