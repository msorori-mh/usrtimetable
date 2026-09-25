import { fetchVersionStudentMemberships } from "./version-student-memberships";
import { buildPartitionIndex } from "@/lib/auto-scheduler/student-partitions";

/** One selected-version snapshot, shared by quality and conflict checks. */
export async function fetchStudentMembershipIndex(versionId: string, groupIds: string[]) {
  const members = await fetchVersionStudentMemberships(versionId, groupIds);
  const cohortIdsByGroup: Record<string, string[]> = {};
  for (const member of members) {
    cohortIdsByGroup[member.delivery_group_id] = [
      ...new Set([...(cohortIdsByGroup[member.delivery_group_id] ?? []), member.cohort_id]),
    ];
  }
  return buildPartitionIndex({
    cohortIdsByGroup,
    rows: members.flatMap((m) =>
      m.partition_id
        ? [
            {
              delivery_group_id: m.delivery_group_id,
              cohort_id: m.cohort_id,
              partition_id: m.partition_id,
              partition_headcount: m.partition_headcount,
              shared_lecture: m.shared_lecture,
            },
          ]
        : [],
    ),
    expectedStudents: Object.fromEntries(
      members.map((m) => [m.delivery_group_id, m.expected_students]),
    ),
  });
}
