import { supabase } from "@/integrations/supabase/client";
import {
  mapAssignmentRpcError,
  parseWorkspacePayload,
  workspaceRpcArgs,
} from "@/lib/academic-delivery/teaching-assignments-v2";

type AssignmentReadClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

/** Assignment metadata for a report; session lecturers remain the timetable's authority. */
export async function fetchReportAssignmentRefs(params: {
  collegeId: string;
  versionId?: string | null;
  groupIds: readonly string[];
}) {
  const groups = new Set(params.groupIds.filter(Boolean));
  if (!groups.size) return [];
  // This is active assignment metadata, not a reconstruction of deactivated
  // historical assignments. Session lecturers remain unchanged in the report.
  const { data, error } = await (supabase as unknown as AssignmentReadClient).rpc(
    params.versionId
      ? "list_teaching_assignment_workspace_for_version"
      : "list_teaching_assignment_workspace",
    workspaceRpcArgs({
      collegeId: params.collegeId,
      scheduleVersionId: params.versionId ?? null,
    }),
  );
  if (error) {
    const mapped = mapAssignmentRpcError(error.message);
    throw new Error(`${mapped.code}: ${mapped.message}`);
  }
  const payload = (data ?? {}) as Record<string, unknown>;
  if (params.versionId && payload.schedule_version_id !== params.versionId) {
    throw new Error("إسنادات التقرير لا تطابق نسخة التقرير المحددة");
  }
  const workspace = parseWorkspacePayload(payload);
  if (!workspace.ok || workspace.college_id !== params.collegeId) {
    throw new Error("تعذر قراءة إسنادات نطاق التقرير المحدد");
  }
  return workspace.rows
    .filter((row) => groups.has(row.delivery_group_id))
    .flatMap((row) =>
      row.instructors.map((instructor) => ({
        id: instructor.assignment_id,
        delivery_group_id: row.delivery_group_id,
        instructor_id: instructor.instructor_id,
        instructor_name: instructor.instructor_name,
        assigned_component_hours: instructor.assigned_component_hours,
      })),
    );
}
