/**
 * Loads the sealed education source publication markers
 * (public.scheduling_policy_exceptions, rule_code = 'education_source_publication')
 * into the pure registry of ./education-publication.ts.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  getEducationSourcePublications,
  setEducationSourcePublications,
  type EducationSourcePublication,
} from "./education-publication";

let inflight: Promise<readonly EducationSourcePublication[]> | null = null;

export function loadEducationSourcePublications(): Promise<readonly EducationSourcePublication[]> {
  inflight ??= (async () => {
    const { data, error } = await supabase
      .from("scheduling_policy_exceptions" as never)
      .select("schedule_version_id, college_id, metadata")
      .eq("rule_code", "education_source_publication");
    if (error) {
      inflight = null;
      throw error;
    }
    const rows = (
      (data ?? []) as Array<{
        schedule_version_id: string | null;
        college_id: string;
        metadata: { term_id?: string | null; role?: string | null } | null;
      }>
    ).flatMap((row) =>
      row.schedule_version_id
        ? [
            {
              version_id: row.schedule_version_id,
              college_id: row.college_id,
              term_id: row.metadata?.term_id ?? null,
              role: row.metadata?.role ?? null,
            },
          ]
        : [],
    );
    setEducationSourcePublications(rows);
    return getEducationSourcePublications();
  })();
  return inflight;
}

/** React hook: re-renders once the markers are loaded. */
export function useEducationSourcePublications() {
  return useQuery({
    queryKey: ["education-source-publications"],
    queryFn: loadEducationSourcePublications,
    staleTime: 10 * 60 * 1000,
  });
}

// Prime once per page load so synchronous readers see the markers.
if (typeof window !== "undefined") {
  void loadEducationSourcePublications().catch(() => undefined);
}
