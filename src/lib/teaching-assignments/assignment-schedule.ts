import type { supabase } from "@/integrations/supabase/client";
import type { ScheduleVersionOption } from "@/lib/reports/types";
import { sessionsForActiveAssignments } from "@/lib/teaching-assignments/assignment-row-days";
import { parseAssignmentPlacementContext } from "./assignment-placement-context";
import type { AssignmentPlacement } from "./assignment-placement-context";

const PAGE_SIZE = 200;

/** Follow the returned count, including when the server caps a page below our request. */
export async function readAllAssignmentPages<T>(
  read: (
    from: number,
    to: number,
  ) => Promise<{
    data: T[] | null;
    count: number | null;
    error: unknown;
  }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const page = await read(rows.length, rows.length + PAGE_SIZE - 1);
    if (page.error) throw page.error;
    if (page.count == null || (!page.data?.length && rows.length < page.count)) {
      throw new Error("تعذر استكمال بيانات التسكين");
    }
    rows.push(...(page.data ?? []));
    if (rows.length >= page.count) return rows;
  }
}

/** Read one complete version at a time; historical drafts cannot truncate the newest draft. */
export async function loadAssignmentSchedule(
  client: Pick<typeof supabase, "from" | "rpc">,
  collegeId: string,
  versions: readonly ScheduleVersionOption[],
  includeEmptyVersion = false,
) {
  const assignments = await readAllAssignmentPages(async (from, to) =>
    client
      .from("teaching_assignments")
      .select("id", { count: "exact" })
      .eq("college_id", collegeId)
      .eq("is_active", true)
      .order("id")
      .range(from, to),
  );
  const activeIds = new Set(assignments.map((assignment) => assignment.id));
  for (const version of versions) {
    const sessions = await readAllAssignmentPages(async (from, to) =>
      client
        .from("schedule_sessions")
        .select("schedule_version_id, delivery_group_id, day_of_week, teaching_assignment_id", {
          count: "exact",
        })
        .eq("college_id", collegeId)
        .eq("schedule_version_id", version.id)
        .not("teaching_assignment_id", "is", null)
        .not("delivery_group_id", "is", null)
        .or("replaced_by_split.is.null,replaced_by_split.eq.false")
        .order("id")
        .range(from, to),
    );
    const activeSessions = sessionsForActiveAssignments(sessions, activeIds);
    // Explicit version views still need the catalogue when nothing is placed yet.
    if (activeSessions.length || includeEmptyVersion) {
      const { data, error } = await client.rpc(
        "schedule_version_assignment_placement_context" as never,
        { p_version: version.id } as never,
      );
      if (error) throw error;
      const placements = parseAssignmentPlacementContext(data, version.id);
      if (activeSessions.some((s) => !placements.get(s.delivery_group_id!)?.inVersion)) {
        throw new Error("حالة التسكين لا تشمل كل جلسات النسخة المحددة");
      }
      return {
        version,
        placements,
        days: new Map([...placements].map(([id, placement]) => [id, placement.days])),
      };
    }
  }
  return {
    version: null,
    days: new Map<string, number[]>(),
    placements: new Map<string, AssignmentPlacement>(),
  };
}
