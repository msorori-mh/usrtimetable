import { supabase } from "@/integrations/supabase/client";

export type SharedLectureLink = {
  anchor_group_id: string;
  member_group_id: string;
  cohort_id: string;
  anchor_cohort_id: string;
  cohort_code: string;
  expected_students: number;
  total_students: number;
  course_name: string;
  study_system: string;
};
const client = supabase as unknown as {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};
export type SharedLectureCandidate = {
  anchor_group_id: string;
  member_group_id: string;
  course_name: string;
  anchor_cohort_code: string;
  member_cohort_code: string;
  total_students: number;
  weekly_hours: number;
};
export async function fetchSharedLectureCandidates(
  collegeId: string,
): Promise<SharedLectureCandidate[]> {
  const { data, error } = await client.rpc("shared_lecture_candidates", { p_college: collegeId });
  if (error) throw new Error(error.message);
  return (data ?? []) as SharedLectureCandidate[];
}
export async function fetchSharedLectures(collegeId: string): Promise<SharedLectureLink[]> {
  const { data, error } = await client.rpc("shared_lecture_catalog", {
    p_college: collegeId,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data)) throw new Error("تعذر قراءة المحاضرات المشتركة");
  return data as SharedLectureLink[];
}
export async function changeSharedLecture(anchor: string, member: string, remove = false) {
  const { error } = await client.rpc(
    remove ? "unmerge_shared_lecture" : "merge_shared_lecture",
    remove ? { p_member: member } : { p_anchor: anchor, p_member: member },
  );
  if (error) throw new Error(error.message);
}
export function sharedGroupIdsForCohort(links: SharedLectureLink[], cohortId?: string) {
  return [
    ...new Set(
      links
        .filter((l) => !cohortId || l.cohort_id === cohortId || l.anchor_cohort_id === cohortId)
        .map((l) => l.anchor_group_id),
    ),
  ];
}
