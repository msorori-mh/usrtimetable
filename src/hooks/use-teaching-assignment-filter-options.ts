import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchSharedLectures } from "@/lib/academic-delivery/shared-lectures";
import { readAllRows } from "@/lib/supabase/read-all";

/**
 * Filter options and row context for the teaching-assignment workspace (programs,
 * levels, terms, cohorts, cohort/shared-lecture context). Split from
 * routes/_authenticated/teaching-assignments.tsx (L-14).
 */
export function useTeachingAssignmentFilterOptions({
  collegeId,
  programId,
  levelId,
  termId,
  studySystem,
}: {
  collegeId: string | undefined;
  programId: string;
  levelId: string;
  termId: string;
  studySystem: string;
}) {
  const { data: programs, error: programsError } = useQuery({
    queryKey: ["programs", collegeId, "teaching-assignment-filter"],
    enabled: !!collegeId,
    queryFn: async () => {
      // read-all-ok: programs of one college (tens)
      const { data, error } = await supabase
        .from("academic_programs")
        .select("id, name, code")
        .eq("college_id", collegeId!);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: levels, error: levelsError } = useQuery({
    queryKey: ["academic-levels", collegeId, "teaching-assignment-filter", programId],
    enabled: !!collegeId && !!programId,
    queryFn: async () => {
      // read-all-ok: levels of one program
      const { data, error } = await supabase
        .from("academic_levels")
        .select("id, name, level_number")
        .eq("college_id", collegeId!)
        .eq("program_id", programId)
        .order("level_number");
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: terms, error: termsError } = useQuery({
    queryKey: ["academic-terms", collegeId, "teaching-assignment-filter"],
    enabled: !!collegeId,
    queryFn: async () => {
      // read-all-ok: terms of one college (tens)
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id, name")
        .eq("college_id", collegeId!);
      if (error) throw error;
      return data ?? [];
    },
  });
  const { data: cohorts, error: cohortsError } = useQuery({
    queryKey: [
      "academic-cohorts",
      collegeId,
      "teaching-assignment-filter",
      programId,
      levelId,
      termId,
      studySystem,
    ],
    enabled: !!collegeId,
    queryFn: () =>
      readAllRows<{
        id: string;
        code: string | null;
        program_id: string;
        level_id: string;
        term_id: string;
        study_system: string;
      }>((from, to) => {
        let q = supabase
          .from("academic_cohorts")
          .select("id, code, program_id, level_id, term_id, study_system")
          .eq("college_id", collegeId!);
        if (programId) q = q.eq("program_id", programId);
        if (levelId) q = q.eq("level_id", levelId);
        if (termId) q = q.eq("term_id", termId);
        if (studySystem) q = q.eq("study_system", studySystem);
        return q.order("code").order("id").range(from, to);
      }),
  });
  const { data: academicContext, error: academicContextError } = useQuery({
    queryKey: ["teaching-assignment-row-context", collegeId],
    enabled: !!collegeId,
    queryFn: async () => {
      const [cohortRows, sharedLectures] = await Promise.all([
        readAllRows<{ id: string; program_id: string; study_system: string }>((from, to) =>
          supabase
            .from("academic_cohorts")
            .select("id, program_id, study_system")
            .eq("college_id", collegeId!)
            .order("id")
            .range(from, to),
        ),
        fetchSharedLectures(collegeId!),
      ]);
      return { cohorts: cohortRows, sharedLectures };
    },
  });
  const filterOptionsError =
    programsError ?? levelsError ?? termsError ?? cohortsError ?? academicContextError;
  return { programs, levels, terms, cohorts, academicContext, filterOptionsError };
}
