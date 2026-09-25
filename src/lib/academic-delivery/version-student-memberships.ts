import { supabase } from "@/integrations/supabase/client";

export type VersionStudentMembership = {
  delivery_group_id: string;
  cohort_id: string;
  partition_id: string | null;
  partition_headcount: number | null;
  shared_lecture: boolean;
  expected_students: number;
};

/** All requested groups are resolved against one version by the tenant-checked RPC. */
export async function fetchVersionStudentMemberships(
  versionId: string,
  groupIds: string[],
): Promise<VersionStudentMembership[]> {
  const ids = [...new Set(groupIds.filter(Boolean))];
  const rows: VersionStudentMembership[] = [];
  const client = supabase as unknown as {
    rpc(
      name: string,
      args: { p_version: string; p_groups: string[] },
    ): Promise<{
      data: VersionStudentMembership[] | null;
      error: { message: string } | null;
    }>;
  };
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const { data, error } = await client.rpc("schedule_version_student_memberships", {
      p_version: versionId,
      p_groups: batch,
    });
    if (error) throw new Error(error.message);
    const found = new Set((data ?? []).map((row) => row.delivery_group_id));
    if (batch.some((id) => !found.has(id))) {
      throw new Error("عضوية مجموعة التدريس غير مكتملة في نسخة الجدول المحددة.");
    }
    rows.push(...(data ?? []));
  }
  return rows;
}
