import { supabase } from "@/integrations/supabase/client";
import {
  hydrateWorkspaceSessions,
  TIMETABLE_SESSION_FLAT_SELECT,
  type WorkspaceSessionFlatRow,
} from "@/lib/schedule-builder/queries";

/** Complete occupancy across both systems; never infer vacancy from a truncated response. */
export async function fetchRoomOccupancy(collegeId: string, versionId: string) {
  const rows: WorkspaceSessionFlatRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase
      .from("schedule_sessions")
      .select(TIMETABLE_SESSION_FLAT_SELECT)
      .eq("college_id", collegeId)
      .eq("schedule_version_id", versionId)
      .eq("replaced_by_split", false)
      .order("id")
      .range(offset, offset + 499);
    if (result.error) throw result.error;
    rows.push(...((result.data ?? []) as WorkspaceSessionFlatRow[]));
    if ((result.data?.length ?? 0) < 500) break;
  }
  return hydrateWorkspaceSessions(rows);
}

export async function fetchRoomsInventory(collegeId: string) {
  const [rooms, roomTypes, availability, settings] = await Promise.all([
    supabase
      .from("rooms")
      .select("id, code, name, capacity, room_type_id, room_type, is_active")
      .eq("college_id", collegeId)
      .order("code"),
    supabase.from("room_types").select("id, name_ar, name_en, code").eq("college_id", collegeId),
    supabase
      .from("room_availability")
      .select("room_id, day_of_week, start_time, end_time")
      .eq("college_id", collegeId),
    supabase
      .from("scheduling_settings")
      .select("working_days, day_start_time, day_end_time")
      .eq("college_id", collegeId)
      .maybeSingle(),
  ]);
  const error = rooms.error ?? roomTypes.error ?? availability.error ?? settings.error;
  if (error) throw error;
  return {
    rooms: rooms.data ?? [],
    roomTypes: roomTypes.data ?? [],
    availability: availability.data ?? [],
    settings: settings.data,
  };
}

export async function fetchRoomDecisionConstraints(collegeId: string) {
  const [closures, assignments] = await Promise.all([
    supabase
      .from("room_unavailability")
      .select("room_id, day_of_week, start_time, end_time, start_date, end_date")
      .eq("college_id", collegeId),
    supabase
      .from("teaching_assignments")
      .select("id, required_room_type")
      .eq("college_id", collegeId),
  ]);
  if (closures.error || assignments.error) throw closures.error ?? assignments.error;
  return {
    closures: closures.data ?? [],
    requiredTypes: new Map((assignments.data ?? []).map((a) => [a.id, a.required_room_type])),
  };
}
