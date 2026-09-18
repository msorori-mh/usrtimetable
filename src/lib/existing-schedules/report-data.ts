import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import type { WorkspaceSessionHydratedRow } from "../schedule-builder/session-hydrate";
import type { IntakeMembership } from "./presentation";

export async function attachIntakePresentation(
  rows: WorkspaceSessionHydratedRow[],
): Promise<WorkspaceSessionHydratedRow[]> {
  if (!rows.length) return rows;
  const sources: Pick<
    Tables<"existing_schedule_source_rows">,
    | "source_id"
    | "schedule_session_id"
    | "cohort_id"
    | "delivery_group_id"
    | "study_plan_id"
    | "instructor_ids"
    | "pending_reasons"
    | "shared_member"
    | "raw_room"
  >[] = [];
  for (let i = 0; i < rows.length; i += 100) {
    const { data, error } = await supabase
      .from("existing_schedule_source_rows")
      .select(
        "source_id,schedule_session_id,cohort_id,delivery_group_id,study_plan_id,instructor_ids,pending_reasons,shared_member,raw_room",
      )
      .in(
        "schedule_session_id",
        rows.slice(i, i + 100).map((r) => r.id),
      );
    if (error) throw error;
    sources.push(...(data ?? []));
  }
  if (!sources.length) return rows;
  const ids = (values: (string | null)[]) => [
    ...new Set(values.filter((x): x is string => !!x)),
  ];
  const [cohortResult, instructorResult] = await Promise.all([
    supabase
      .from("academic_cohorts")
      .select("id,program_id,level_id")
      .in("id", ids(sources.map((s) => s.cohort_id))),
    supabase
      .from("instructors")
      .select("id,full_name")
      .in("id", ids(sources.flatMap((s) => s.instructor_ids))),
  ]);
  if (cohortResult.error) throw cohortResult.error;
  if (instructorResult.error) throw instructorResult.error;
  const cohorts = cohortResult.data ?? [];
  const [programResult, levelResult] = await Promise.all([
    supabase
      .from("academic_programs")
      .select("id,name,department_id")
      .in("id", ids(cohorts.map((c) => c.program_id))),
    supabase
      .from("academic_levels")
      .select("id,name")
      .in("id", ids(cohorts.map((c) => c.level_id))),
  ]);
  if (programResult.error) throw programResult.error;
  if (levelResult.error) throw levelResult.error;
  const { data: departments, error } = await supabase
    .from("departments")
    .select("id,name")
    .in("id", ids((programResult.data ?? []).map((p) => p.department_id)));
  if (error) throw error;
  const cohortMap = new Map(cohorts.map((c) => [c.id, c]));
  const programMap = new Map((programResult.data ?? []).map((p) => [p.id, p]));
  const levelMap = new Map((levelResult.data ?? []).map((l) => [l.id, l.name]));
  const deptMap = new Map((departments ?? []).map((d) => [d.id, d.name]));
  const names = new Map(
    (instructorResult.data ?? []).map((i) => [i.id, i.full_name]),
  );
  return rows.map((row) => {
    const members = sources.filter((s) => s.schedule_session_id === row.id);
    if (!members.length) return row;
    const primary = members.find((s) => !s.shared_member) ?? members[0];
    const memberships: IntakeMembership[] = members.flatMap((s) => {
      const c = cohortMap.get(s.cohort_id ?? "");
      const p = c && programMap.get(c.program_id);
      if (!c || !p || !s.delivery_group_id || !s.study_plan_id) return [];
      return [
        {
          source_id: s.source_id,
          cohort_id: c.id,
          delivery_group_id: s.delivery_group_id,
          study_plan_id: s.study_plan_id,
          program_id: p.id,
          program_name: p.name,
          level_id: c.level_id,
          level_name: levelMap.get(c.level_id) ?? "",
          department_id: p.department_id,
          department_name: deptMap.get(p.department_id) ?? "",
        },
      ];
    });
    return {
      ...row,
      intake_memberships: memberships,
      intake_instructor_ids: primary.instructor_ids,
      intake_pending_reasons: primary.pending_reasons,
      shared_cohort_ids: ids(members.map((s) => s.cohort_id)),
      instructors: {
        full_name: primary.instructor_ids
          .map((id) => names.get(id) ?? "محاضر بانتظار المراجعة")
          .join(" + "),
      },
      rooms: row.rooms ?? {
        name:
          primary.raw_room === "احتياج"
            ? "قاعة بانتظار التحديد"
            : `${primary.raw_room || "قاعة"} — بانتظار الربط`,
      },
    };
  });
}
