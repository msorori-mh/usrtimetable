import { supabase } from "@/integrations/supabase/client";
import { readAllReportRows } from "@/lib/reports/read-all";
import { facultyWorkflow } from "@/lib/instructors/faculty-workflow";
import { mapRawSessions } from "@/lib/reports/session-mappers";
import { fetchCohortDeliveryGroupLabels, fetchInstructorScheduleSessions } from "./session-queries";
import {
  facultyRecordIds,
  canViewInstructorAcrossColleges,
  summarizeUniversitySchedule,
  mergeInstructorDirectories,
  isTestScheduleLabel,
  type CollegeScheduleScope,
  type UniversityInstructorSession,
} from "../university-instructor-schedule";

async function reportCanViewAcrossColleges() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("يجب تسجيل الدخول لعرض التقرير.");
  const roles = await supabase.from("user_roles").select("role").eq("user_id", data.user.id);
  if (roles.error) throw roles.error;
  return canViewInstructorAcrossColleges((roles.data ?? []).map((r) => r.role));
}

function sessionProgramId(session: { course_offerings?: unknown }): string | null {
  const offering = session.course_offerings;
  if (!offering || typeof offering !== "object" || !("program_id" in offering)) return null;
  return typeof offering.program_id === "string" ? offering.program_id : null;
}

interface AcademicOwnerRow {
  program_id: string;
  owner_program_id: string;
  program_name: string;
  college_id: string;
  college_name: string;
  department_name: string | null;
}

/** The owning college of a hosted program can be another college, which a college
 * administrator may not read. The server resolves the canonical link for programs
 * the caller can already read; a broken link yields no row and is rejected here. */
async function academicOwners(programIds: string[]) {
  const ids = [...new Set(programIds)];
  const client = supabase as unknown as {
    rpc(
      name: "academic_program_owners",
      args: { p_program_ids: string[] },
    ): Promise<{ data: AcademicOwnerRow[] | null; error: { message: string } | null }>;
  };
  const rows: AcademicOwnerRow[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await client.rpc("academic_program_owners", {
      p_program_ids: ids.slice(i, i + 100),
    });
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  const byProgram = new Map(rows.map((row) => [row.program_id, row]));
  return new Map(
    ids.map((id) => {
      const owner = byProgram.get(id);
      if (!owner)
        throw new Error("تعذر قراءة البرنامج الأكاديمي المعتمد؛ لا يمكن تحديد كلية المحاضرة بدقة.");
      return [
        id,
        {
          college_id: owner.college_id,
          college_name: owner.college_name,
          program_name: owner.program_name,
          department_name: owner.department_name ?? "",
        },
      ];
    }),
  );
}

export async function fetchUniversityScheduleDirectory(collegeId: string) {
  if (!collegeId) throw new Error("اختر الكلية أولًا.");
  const canViewAcrossColleges = await reportCanViewAcrossColleges();
  // Each roster read uses the authenticated, college-scoped RPC.
  const [roster, colleges, terms, versions] = await Promise.all([
    facultyWorkflow.rpc("get_college_instructor_schedule_directory", { p_college_id: collegeId }),
    readAllReportRows((from, to) => {
      let q = supabase.from("colleges").select("id, name, university_id");
      if (!canViewAcrossColleges) q = q.eq("id", collegeId);
      return q.order("id").range(from, to);
    }),
    readAllReportRows((from, to) => {
      let q = supabase.from("academic_terms").select("id, college_id, name, start_date, end_date");
      if (!canViewAcrossColleges) q = q.eq("college_id", collegeId);
      return q.order("id").range(from, to);
    }),
    readAllReportRows((from, to) => {
      let q = supabase
        .from("schedule_versions")
        .select("id, college_id, academic_term_id, name, status, created_at, is_coordination");
      if (!canViewAcrossColleges) q = q.eq("college_id", collegeId);
      return q.order("id").range(from, to);
    }),
  ]);
  if (roster.error) throw roster.error;
  const universityId = colleges.find((c) => c.id === collegeId)?.university_id;
  const universityColleges = colleges.filter(
    (c) => !!universityId && c.university_id === universityId && !isTestScheduleLabel(c.name),
  );
  const otherRosters = canViewAcrossColleges
    ? await Promise.all(
        universityColleges
          .filter((c) => c.id !== collegeId)
          .map(async (c) => {
            const result = await facultyWorkflow.rpc("get_college_instructor_schedule_directory", {
              p_college_id: c.id,
            });
            if (result.error) throw result.error;
            return result.data ?? [];
          }),
      )
    : [];
  return {
    collegeId,
    currentInstructorIdentityIds: [
      ...new Set((roster.data ?? []).map((instructor) => instructor.identity_id)),
    ],
    instructors: mergeInstructorDirectories([...(roster.data ?? []), ...otherRosters.flat()]),
    colleges: universityColleges,
    terms,
    versions,
    canViewAcrossColleges,
  };
}

export async function fetchUniversityInstructorSchedule(input: {
  anchorCollegeId: string;
  selected: { id: string; university_number: string | null };
  records: { id: string; university_number: string | null }[];
  scopes: CollegeScheduleScope[];
}): Promise<UniversityInstructorSession[]> {
  const ids = facultyRecordIds(input.selected, input.records);
  const across = await reportCanViewAcrossColleges();
  const scopes = input.scopes.filter((s) => across || s.collegeId === input.anchorCollegeId);
  const bundles = await Promise.all(
    scopes.map(async (scope) => {
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
      const owners = await academicOwners(
        raw.flatMap((s) => {
          const id = sessionProgramId(s);
          return id ? [id] : [];
        }),
      );
      return mapRawSessions(raw, labels).map((s, i) => ({
        ...s,
        college_id: scope.collegeId,
        college_name: scope.collegeName,
        ...owners.get(sessionProgramId(raw[i]) ?? ""),
        source_college_id: scope.collegeId,
        source_college_name: scope.collegeName,
        version_name: scope.version.name,
        workload_pending:
          Array.isArray(raw[i].intake_instructor_ids) && raw[i].intake_instructor_ids.length > 1,
      }));
    }),
  );
  const sessions = bundles.flat();
  summarizeUniversitySchedule(sessions, {}); // Reject invalid times in the query error state.
  return sessions;
}

/** Discover teaching in candidate versions, including imported co-teaching.
 * Checking all options keeps the selector usable when a chosen version is empty.
 * Every read remains college-scoped and subject to RLS.
 */
export async function fetchInstructorTeachingCollegeIds(input: {
  selected: { id: string; university_number: string | null };
  records: { id: string; university_number: string | null }[];
  scopes: CollegeScheduleScope[];
}): Promise<string[]> {
  if (!(await reportCanViewAcrossColleges())) return [];
  const ids = facultyRecordIds(input.selected, input.records);
  const matches = await Promise.all(
    input.scopes.map(async (scope) => {
      const versions = scope.options.map((v) => v.id);
      const participation = await readAllReportRows((from, to) =>
        supabase
          .from("existing_schedule_source_rows")
          .select("schedule_session_id")
          .eq("college_id", scope.collegeId)
          .in("schedule_version_id", versions)
          .overlaps("instructor_ids", ids)
          .not("schedule_session_id", "is", null)
          .order("id")
          .range(from, to),
      );
      const sessionIds = [...new Set(participation.map((p) => p.schedule_session_id!))];
      // Chunk imported IDs to keep PostgREST query URLs bounded.
      const chunks: string[][] = [];
      for (let i = 0; i < sessionIds.length; i += 100) chunks.push(sessionIds.slice(i, i + 100));
      if (!chunks.length) chunks.push([]);
      for (const chunk of chunks) {
        let query = supabase
          .from("schedule_sessions")
          .select("id")
          .eq("college_id", scope.collegeId)
          .in("schedule_version_id", versions)
          .or("replaced_by_split.is.null,replaced_by_split.eq.false");
        query = chunk.length
          ? query.or(`instructor_id.in.(${ids.join(",")}),id.in.(${chunk.join(",")})`)
          : query.in("instructor_id", ids);
        const { data, error } = await query.limit(1);
        if (error) throw error;
        if (data?.length) return scope.collegeId;
      }
      return null;
    }),
  );
  return matches.filter((id): id is string => id !== null);
}
