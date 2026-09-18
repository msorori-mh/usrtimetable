import { supabase } from "@/integrations/supabase/client";
import { readAllReportRows } from "@/lib/reports/read-all";
import { withUniversityNumbers } from "@/lib/instructors/university-number";
import { mapRawSessions } from "@/lib/reports/session-mappers";
import { fetchCohortDeliveryGroupLabels, fetchInstructorScheduleSessions } from "./session-queries";
import {
  facultyRecordIds,
  summarizeUniversitySchedule,
  type CollegeScheduleScope,
  type UniversityInstructorSession,
} from "../university-instructor-schedule";

export async function fetchUniversityScheduleDirectory() {
  // All reads remain subject to RLS. A partial response is labelled as accessible scope.
  const [records, types, colleges, terms, versions] = await Promise.all([
    readAllReportRows((from, to) =>
      supabase
        .from("instructors")
        .select(
          "id, college_id, full_name, max_weekly_hours, administrative_release_hours, instructor_type_id, employment_type",
        )
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase.from("instructor_types").select("id, code").order("id").range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase.from("colleges").select("id, name, university_id").order("id").range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_terms")
        .select("id, college_id, name, start_date, end_date")
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("schedule_versions")
        .select("id, college_id, academic_term_id, name, status, created_at, is_coordination")
        .order("id")
        .range(from, to),
    ),
  ]);
  const instructors = await withUniversityNumbers(
    records.map((r) => ({
      ...r,
      instructor_type_code: types.find((t) => t.id === r.instructor_type_id)?.code ?? null,
    })),
  );
  return { instructors, colleges, terms, versions };
}

export async function fetchUniversityInstructorSchedule(input: {
  selected: { id: string; university_number: string | null };
  records: { id: string; university_number: string | null }[];
  scopes: CollegeScheduleScope[];
}): Promise<UniversityInstructorSession[]> {
  const ids = facultyRecordIds(input.selected, input.records);
  const bundles = await Promise.all(
    input.scopes.map(async (scope) => {
      const sets = await Promise.all(
        ids.map((instructorId) =>
          fetchInstructorScheduleSessions({
            collegeId: scope.collegeId,
            versionId: scope.version.id,
            instructorId,
            studySystem: "all",
          }),
        ),
      );
      const raw = [
        ...new Map(
          sets
            .flat()
            .filter((s) => !s.replaced_by_split)
            .map((s) => [s.id, s]),
        ).values(),
      ];
      const labels = await fetchCohortDeliveryGroupLabels(scope.collegeId, raw);
      return mapRawSessions(raw, labels).map((s, i) => ({
        ...s,
        college_id: scope.collegeId,
        college_name: scope.collegeName,
        version_name: scope.version.name,
        workload_pending: (raw[i].intake_instructor_ids?.length ?? 0) > 1,
      }));
    }),
  );
  const sessions = bundles.flat();
  summarizeUniversitySchedule(sessions, {}); // Reject invalid times in the query error state.
  return sessions;
}
