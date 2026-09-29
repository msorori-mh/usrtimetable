import { supabase } from "@/integrations/supabase/client";
import { readAllReportRows } from "./read-all";
import { leadershipOverviewSchema } from "./leadership";
import { leadershipDetailsSchema } from "./leadership-metrics";
import { ReportScopeError } from "./preferences";
import type { UniversityOverviewSources, OverviewSession } from "./university-overview";

export async function fetchUniversityOverview(period: { year: string; type: string } | null) {
  // This RPC determines authorization and term scope. A browser filter can only narrow it.
  const overviewResult = await supabase.rpc("leadership_overview", {
    p_academic_year: period?.year ?? undefined,
    p_term_type: period?.type ?? undefined,
  });
  if (overviewResult.error) throw new ReportScopeError("تعذر تحميل ملخص الجامعة. أعد المحاولة.");
  const overview = leadershipOverviewSchema.parse(overviewResult.data);
  const colleges = overview.colleges.filter((c) => !c.college.includes("اختبار تبسيط الجداول"));
  const collegeIds = colleges.map((c) => c.college_id);
  const termIds = colleges.flatMap((c) =>
    c.term_state === "ready" && c.term_id ? [c.term_id] : [],
  );
  if (!collegeIds.length) return { overview, sources: null };
  const [
    collegeCodes,
    departments,
    programs,
    cohorts,
    groups,
    rooms,
    settings,
    availability,
    roomTypes,
    versions,
    teachingResult,
  ] = await Promise.all([
    readAllReportRows((from, to) =>
      supabase.from("colleges").select("id,code").in("id", collegeIds).order("id").range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("departments")
        .select("id,college_id,name,is_archived")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_programs")
        .select("id,college_id,department_id,name,is_archived")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("academic_cohorts")
        .select("id,college_id,term_id,program_id")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("delivery_groups")
        .select("id,college_id,cohort_id")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("rooms")
        .select(
          "id,college_id,name,code,room_type_id,capacity,is_active,available_days,available_start_time,available_end_time",
        )
        .in("college_id", collegeIds)
        .eq("is_active", true)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("scheduling_settings")
        .select("college_id,working_days,day_start_time,day_end_time")
        .in("college_id", collegeIds)
        .order("college_id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("room_availability")
        .select("id,room_id,day_of_week,start_time,end_time")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    readAllReportRows((from, to) =>
      supabase
        .from("room_types")
        .select("id,name_ar,code")
        .in("college_id", collegeIds)
        .order("id")
        .range(from, to),
    ),
    termIds.length
      ? readAllReportRows((from, to) =>
          supabase
            .from("schedule_versions")
            .select(
              "id,college_id,academic_term_id,name,status,created_at,updated_at,disposable_test",
            )
            .in("college_id", collegeIds)
            .in("academic_term_id", termIds)
            .in("status", ["published", "draft", "review", "approved"])
            .eq("disposable_test", false)
            .order("id")
            .range(from, to),
        )
      : Promise.resolve([]),
    supabase.rpc("leadership_metric_details", {
      p_metric: "teaching",
      p_academic_year: overview.year ?? undefined,
      p_term_type: overview.term_type ?? undefined,
    }),
  ]);
  if (teachingResult.error)
    throw new ReportScopeError("تعذر تحميل احتياج الأقسام من الساعات. أعد المحاولة.");
  const teaching = leadershipDetailsSchema.parse(teachingResult.data);
  if (teaching.year !== overview.year || teaching.term_type !== overview.term_type)
    throw new ReportScopeError("تغير الفصل أثناء القراءة؛ حدّث التقرير.");
  const collegeById = new Map(colleges.map((c) => [c.college_id, c]));
  const codes = new Map(collegeCodes.map((c) => [c.id, c.code?.trim().toUpperCase()]));
  const candidates = versions.filter((v) => {
    const college = collegeById.get(v.college_id);
    return (
      college?.term_state === "ready" &&
      v.academic_term_id === college.term_id &&
      (v.id === college.version_id ||
        (codes.get(v.college_id) === "ITCS" && ["draft", "review", "approved"].includes(v.status)))
    );
  });
  // Chunk IDs to keep PostgREST URLs bounded; paginate every chunk (no 1,000-row truncation).
  const sessions: OverviewSession[] = [];
  for (let index = 0; index < candidates.length; index += 40) {
    const ids = candidates.slice(index, index + 40).map((v) => v.id);
    sessions.push(
      ...(await readAllReportRows((from, to) =>
        supabase
          .from("schedule_sessions")
          .select(
            "id,college_id,schedule_version_id,delivery_group_id,cohort_id,instructor_id,room_id,session_type,day_of_week,start_time,end_time,replaced_by_split",
          )
          .in("college_id", collegeIds)
          .in("schedule_version_id", ids)
          .or("replaced_by_split.is.null,replaced_by_split.eq.false")
          .order("id")
          .range(from, to),
      )),
    );
  }
  const sources: UniversityOverviewSources = {
    colleges,
    collegeCodes,
    departments,
    programs,
    cohorts,
    groups,
    rooms,
    settings,
    availability,
    roomTypes,
    versions: candidates,
    sessions,
    teaching: teaching.rows,
  };
  return { overview, sources };
}
