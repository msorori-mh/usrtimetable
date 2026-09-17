import type { supabase } from "@/integrations/supabase/client";
import type { ScheduleVersionOption } from "@/lib/reports/types";
import {
  deliveryGroupDayMap,
  sessionsForActiveAssignments,
} from "@/lib/teaching-assignments/assignment-row-days";

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
  client: Pick<typeof supabase, "from">,
  collegeId: string,
  versions: readonly ScheduleVersionOption[],
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
        .order("id")
        .range(from, to),
    );
    const activeSessions = sessionsForActiveAssignments(sessions, activeIds);
    if (activeSessions.length) {
      return { version, days: deliveryGroupDayMap(activeSessions) };
    }
  }
  return { version: null, days: new Map<string, number[]>() };
}
