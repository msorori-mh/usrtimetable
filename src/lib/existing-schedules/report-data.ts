import type { Tables } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { chunkIds, readAllRows } from "@/lib/supabase/read-all";
import type { WorkspaceSessionHydratedRow } from "../schedule-builder/session-hydrate";
import type { IntakeMembership } from "./presentation";

/** Reads rows for an id list in URL-bounded chunks, failing on any chunk error. */
async function readByIdChunks<T>(
  ids: string[],
  read: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (const chunk of chunkIds(ids, 100)) {
    const { data, error } = await read(chunk);
    if (error) throw error;
    out.push(...(data ?? []));
  }
  return out;
}

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
  // H-10: chunk the session ids and paginate each chunk (merged lectures carry
  // several source rows per session).
  for (const chunk of chunkIds(
    rows.map((r) => r.id),
    100,
  )) {
    const data = await readAllRows<(typeof sources)[number]>((from, to) =>
      supabase
        .from("existing_schedule_source_rows")
        .select(
          "id,source_id,schedule_session_id,cohort_id,delivery_group_id,study_plan_id,instructor_ids,pending_reasons,shared_member,raw_room",
        )
        .in("schedule_session_id", chunk)
        .order("id")
        .range(from, to),
    );
    sources.push(...data);
  }
  if (!sources.length) return rows;
  const ids = (values: (string | null)[]) => [...new Set(values.filter((x): x is string => !!x))];
  const [cohorts, instructorRows] = await Promise.all([
    readByIdChunks<{ id: string; program_id: string; level_id: string }>(
      ids(sources.map((s) => s.cohort_id)),
      (chunk) => supabase.from("academic_cohorts").select("id,program_id,level_id").in("id", chunk),
    ),
    readByIdChunks<{ id: string; full_name: string }>(
      ids(sources.flatMap((s) => s.instructor_ids)),
      (chunk) => supabase.from("instructors").select("id,full_name").in("id", chunk),
    ),
  ]);
  const [programs, levels] = await Promise.all([
    readByIdChunks<{ id: string; name: string; department_id: string }>(
      ids(cohorts.map((c) => c.program_id)),
      (chunk) => supabase.from("academic_programs").select("id,name,department_id").in("id", chunk),
    ),
    readByIdChunks<{ id: string; name: string }>(ids(cohorts.map((c) => c.level_id)), (chunk) =>
      supabase.from("academic_levels").select("id,name").in("id", chunk),
    ),
  ]);
  const departments = await readByIdChunks<{ id: string; name: string }>(
    ids(programs.map((p) => p.department_id)),
    (chunk) => supabase.from("departments").select("id,name").in("id", chunk),
  );
  const cohortMap = new Map(cohorts.map((c) => [c.id, c]));
  const programMap = new Map(programs.map((p) => [p.id, p]));
  const levelMap = new Map(levels.map((l) => [l.id, l.name]));
  const deptMap = new Map(departments.map((d) => [d.id, d.name]));
  const names = new Map(instructorRows.map((i) => [i.id, i.full_name]));
  const sourcesBySession = new Map<string, typeof sources>();
  for (const source of sources) {
    if (!source.schedule_session_id) continue;
    const list = sourcesBySession.get(source.schedule_session_id) ?? [];
    list.push(source);
    sourcesBySession.set(source.schedule_session_id, list);
  }
  return rows.map((row) => {
    const members = sourcesBySession.get(row.id) ?? [];
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
