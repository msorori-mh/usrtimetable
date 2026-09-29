import { supabase } from "@/integrations/supabase/client";
import { readAllReportRows } from "./read-all";
import {
  buildLeadershipRoomCapacity,
  type CapacityCollege,
  type CapacitySources,
} from "./leadership-room-capacity";

/** Read-only; college IDs and published version IDs come from the authorized overview. */
export async function fetchLeadershipRoomCapacity(colleges: CapacityCollege[]) {
  if (!colleges.length) return [];
  const collegeIds = colleges.map((c) => c.college_id);
  const versionIds = colleges.flatMap((c) => (c.version_id ? [c.version_id] : []));
  const [rooms, settings, availability, unavailability, sessions, roomTypes] = await Promise.all([
    readAllReportRows((from, to) =>
      supabase
        .from("rooms")
        .select(
          "id,college_id,name,code,room_type_id,capacity,is_active,available_days,available_start_time,available_end_time",
        )
        .in("college_id", collegeIds)
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("scheduling_settings")
        .select("college_id,working_days,day_start_time,day_end_time")
        .in("college_id", collegeIds)
        .order("college_id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("room_availability")
        .select("id,room_id,day_of_week,start_time,end_time")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("room_unavailability")
        .select("id,room_id,day_of_week,start_time,end_time,start_date,end_date")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    versionIds.length
      ? readAllReportRows((from, to) =>
          supabase
            .from("schedule_sessions")
            .select("id,room_id,schedule_version_id,instructor_id,day_of_week,start_time,end_time")
            .in("schedule_version_id", versionIds)
            .or("replaced_by_split.is.null,replaced_by_split.eq.false")
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([]),
    readAllReportRows((from, to) =>
      supabase
        .from("room_types")
        .select("id,name_ar,code")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
  ]);
  return buildLeadershipRoomCapacity(colleges, {
    rooms,
    settings,
    availability,
    unavailability,
    sessions,
    roomTypes,
  } as CapacitySources);
}
