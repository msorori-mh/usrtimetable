/**
 * Single source of truth for the room-type requirement used by candidate
 * generation, so the client never filters out a room the guarded RPC accepts.
 *
 * The database authority is `teaching_assignments.required_room_type`
 * (`public.is_assignment_room_compatible` / `_ss_room_type` read that column and
 * only consult `plan_course_components.component_type` to allow the practical
 * `computer_lab` → `lecture_hall` fallback). `feasible()` mirrors that column too.
 *
 * The plan component's `required_room_type_id` may disagree with it (stale plan
 * data). Preferring the component id made the client build candidate pools for a
 * different room type than the RPC enforces, dropping every legal computer lab
 * for practical sessions before the server was ever asked. The assignment column
 * therefore wins; the plan values are only used when the assignment has none.
 */

export interface RoomRequirementSources {
  /** teaching_assignments.required_room_type — authoritative when present. */
  assignmentRequiredRoomType?: string | null;
  /** plan_course_components.required_room_type_id — fallback only. */
  componentRoomTypeId?: string | null;
  /** plan_courses.required_room_type_for_lab / _for_lecture — last fallback. */
  planCourseRoomType?: string | null;
}

export interface ResolvedRoomRequirement {
  roomTypeName: string | null;
  roomTypeId: string | null;
}

const clean = (value: string | null | undefined): string | null => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

export function resolveRoomRequirement(sources: RoomRequirementSources): ResolvedRoomRequirement {
  const assignmentType = clean(sources.assignmentRequiredRoomType);
  if (assignmentType) return { roomTypeName: assignmentType, roomTypeId: null };
  const componentId = clean(sources.componentRoomTypeId);
  if (componentId) return { roomTypeName: null, roomTypeId: componentId };
  return { roomTypeName: clean(sources.planCourseRoomType), roomTypeId: null };
}
