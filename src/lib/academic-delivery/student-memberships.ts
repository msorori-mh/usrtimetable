import { supabase } from "@/integrations/supabase/client";
import { readAllReportRows } from "@/lib/reports/read-all";
import { fetchSharedLectures } from "./shared-lectures";
import { buildPartitionIndex } from "@/lib/auto-scheduler/student-partitions";

/** One tenant-scoped snapshot, shared by quality checks and student-conflict validation. */
export async function fetchStudentMembershipIndex(collegeId: string) {
  const [groups, members, links] = await Promise.all([
    readAllReportRows((from, to) =>
      supabase
        .from("operational_delivery_groups")
        .select("id, expected_students")
        .eq("college_id", collegeId)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("operational_group_members")
        .select("delivery_group_id, cohort_id, partition_id, partition_headcount, shared_lecture")
        .eq("college_id", collegeId)
        .eq("partition_active", true)
        .order("id")
        .order("delivery_group_id")
        .range(from, to),
    ),
    fetchSharedLectures(collegeId),
  ]);
  return buildPartitionIndex({
    cohortIdsByGroup: Object.fromEntries(
      links.map((l) => [l.anchor_group_id, [l.anchor_cohort_id, l.cohort_id]]),
    ),
    rows: members.flatMap((m) =>
      m.delivery_group_id && m.cohort_id && m.partition_id
        ? [
            {
              delivery_group_id: m.delivery_group_id,
              cohort_id: m.cohort_id,
              partition_id: m.partition_id,
              partition_headcount: m.partition_headcount,
              shared_lecture: m.shared_lecture ?? false,
            },
          ]
        : [],
    ),
    expectedStudents: Object.fromEntries(groups.map((g) => [g.id, g.expected_students])),
  });
}
