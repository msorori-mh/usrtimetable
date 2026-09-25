import { supabase } from "@/integrations/supabase/client";
import { fetchSharedLectures } from "@/lib/academic-delivery/shared-lectures";
import {
  parseWorkspacePayload,
  type TeachingAssignmentWorkspaceRow,
} from "@/lib/academic-delivery/teaching-assignments-v2";
import { readAllReportRows } from "./read-all";
import { buildProgramLevelDemand } from "./teaching-demand-capacity";
import type { LeadershipCollege } from "./leadership";

/** Admin-only detail. The overview determines eligible colleges and terms first. */
export async function fetchTeachingDemandDetails(
  colleges: LeadershipCollege[],
) {
  const ready = colleges.filter((c) => c.term_state === "ready" && c.term_id);
  if (!ready.length)
    return buildProgramLevelDemand({
      colleges: [],
      groups: [],
      cohorts: [],
      programs: [],
      levels: [],
      sharedLinks: [],
    });
  const collegeIds = ready.map((c) => c.college_id);
  const [workspaces, shared, cohorts, programs, levels] = await Promise.all([
    Promise.all(
      ready.map(async (college): Promise<TeachingAssignmentWorkspaceRow[]> => {
        const { data, error } = await supabase.rpc(
          "list_teaching_assignment_workspace",
          {
            p_college_id: college.college_id,
            p_term_id: college.term_id!,
          },
        );
        if (error) throw error;
        const workspace = parseWorkspacePayload(data);
        if (!workspace.ok || workspace.college_id !== college.college_id)
          throw new Error("تعذر إثبات نطاق مجموعات التدريس");
        return workspace.rows.filter((g) => g.active && !g.is_obsolete);
      }),
    ),
    Promise.all(
      ready.map((college) => fetchSharedLectures(college.college_id)),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_cohorts")
        .select("id,college_id,term_id,program_id,level_id,active")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_programs")
        .select("id,college_id,name")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_levels")
        .select("id,college_id,program_id,name,level_number")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
  ]);
  const groups = workspaces.flat();
  const groupIds = new Set(groups.map((g) => g.delivery_group_id));
  return buildProgramLevelDemand({
    colleges: ready,
    groups,
    cohorts,
    programs,
    levels,
    sharedLinks: shared
      .flat()
      .filter((link) => groupIds.has(link.anchor_group_id))
      .map((link) => ({
        anchor_group_id: link.anchor_group_id,
        cohort_id: link.cohort_id,
      })),
  });
}
