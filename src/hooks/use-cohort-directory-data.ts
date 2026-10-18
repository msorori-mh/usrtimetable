import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readAllRows } from "@/lib/supabase/read-all";

/**
 * Cohort directory reads (programs, levels, terms, cohorts, schedule versions and
 * version-scoped cohort counts). Split from routes/_authenticated/academic-cohorts.tsx (L-14).
 */
export type CohortRow = {
  id: string;
  code: string | null;
  study_system: string;
  entry_year: number | null;
  expected_students: number | null;
  count_status: string;
  program_id: string;
  level_id: string;
  term_id: string;
  active: boolean;
};

export type ScheduleVersionChoice = {
  id: string;
  name: string;
  status: string;
  academic_term_id: string;
};

export type VersionCohortFact = {
  cohort_id: string;
  expected_students: number;
};

export function useCohortDirectoryData(collegeId: string | undefined, chosenVersionId: string | null) {
  const { data: programs, error: programsError } = useQuery({
    queryKey: ["programs", collegeId, "options"],
    enabled: !!collegeId,
    queryFn: async () => {
      const { data, error } = await supabase
          .from("academic_programs")
          .select("id, name")
          .eq("college_id", collegeId!)
          // ACADEMIC-ARCHIVE-UI-01: pickers exclude archived records.
          .eq("is_archived", false)
          .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: levels, error: levelsError } = useQuery({
    queryKey: ["cohort-directory-levels", collegeId],
    enabled: !!collegeId,
    queryFn: async () => {
      // read-all-ok: levels of one college (programs × years)
      const { data, error } = await supabase
          .from("academic_levels")
          .select("id, name, level_number, program_id")
          .eq("college_id", collegeId!)
          .order("level_number");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: terms, error: termsError } = useQuery({
    queryKey: ["academic-terms", collegeId, "options"],
    enabled: !!collegeId,
    queryFn: async () => {
      const { data, error } = await supabase
          .from("academic_terms")
          .select("id, name")
          .eq("college_id", collegeId!)
          .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const {
    data: cohorts,
    isLoading,
    error: cohortsError,
  } = useQuery({
    queryKey: ["academic-cohorts", collegeId],
    enabled: !!collegeId,
    queryFn: async () => {
      const data = await readAllRows((from, to) =>
        supabase
          .from("academic_cohorts")
          .select(
            "id, code, study_system, entry_year, expected_students, count_status, program_id, level_id, term_id, active",
          )
          .eq("college_id", collegeId!)
          .order("entry_year", { ascending: false })
          .order("id")
          .range(from, to),
      );
      return data as CohortRow[];
    },
  });

  const {
    data: versions,
    isLoading: versionsLoading,
    error: versionsError,
  } = useQuery({
    queryKey: ["cohort-directory-versions", collegeId],
    enabled: !!collegeId,
    queryFn: async () => {
      // read-all-ok: draft/published versions of one college (tens)
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, name, status, academic_term_id")
        .eq("college_id", collegeId!)
        .in("status", ["draft", "published"])
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ScheduleVersionChoice[];
    },
  });
  const selectedVersion =
    versions?.find((row) => row.id === chosenVersionId) ??
    versions?.find((row) => row.status === "draft") ??
    versions?.[0] ??
    null;
  const {
    data: versionFacts,
    isLoading: versionFactsLoading,
    error: versionFactsError,
  } = useQuery({
    queryKey: ["cohort-directory-version-facts", collegeId, selectedVersion?.id, cohorts],
    enabled: !!selectedVersion && !!cohorts,
    queryFn: async () => {
      const ids = (cohorts ?? [])
        .filter((row) => row.term_id === selectedVersion!.academic_term_id)
        .map((row) => row.id);
      const facts = new Map<string, number>();
      for (let offset = 0; offset < ids.length; offset += 100) {
        const { data, error } = await (
          supabase as unknown as {
            rpc(
              name: string,
              args: { p_version: string; p_cohorts: string[] },
            ): Promise<{
              data: VersionCohortFact[] | null;
              error: { message: string } | null;
            }>;
          }
        ).rpc("schedule_version_cohort_facts", {
          p_version: selectedVersion!.id,
          p_cohorts: ids.slice(offset, offset + 100),
        });
        if (error) throw error;
        for (const row of data ?? []) facts.set(row.cohort_id, row.expected_students);
      }
      return facts;
    },
  });
  return {
    programs, programsError, levels, levelsError, terms, termsError, cohorts, isLoading, cohortsError, versions, versionsLoading, versionsError, selectedVersion, versionFacts, versionFactsLoading, versionFactsError,
  };
}
