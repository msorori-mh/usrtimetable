import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

type Link = { college_id: string; course_id: string; program_id: string };
type LinkDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Functions"> & {
    Functions: Database["public"]["Functions"] & {
      save_course_programs: {
        Args: {
          p_college_id: string;
          p_course_id: string;
          p_nature: string;
          p_program_ids: string[];
          p_expected_updated_at: string;
          p_is_shared: boolean;
        };
        Returns: undefined;
      };
    };
  };
};
export const courseProgramClient = supabase as unknown as SupabaseClient<LinkDatabase>;

export function useCourseProgramLinks(collegeId?: string) {
  return useQuery({
    queryKey: ["course-program-links", collegeId],
    enabled: !!collegeId,
    queryFn: async () => {
      const programs = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
          .from("academic_programs")
          .select("id, name")
          .eq("college_id", collegeId!)
          .order("id")
          .range(from, from + 499);
        if (error) throw error;
        programs.push(...data);
        if (data.length < 500) break;
      }
      programs.sort((a, b) => a.name.localeCompare(b.name, "ar"));
      const links: Link[] = [];
      for (let from = 0; ; from += 500) {
        const { data, error } = await courseProgramClient
          .from("course_programs")
          .select("college_id, course_id, program_id")
          .eq("college_id", collegeId!)
          .order("course_id")
          .order("program_id")
          .range(from, from + 499);
        if (error) throw error;
        links.push(...data);
        if (data.length < 500) break;
      }
      return { programs, links };
    },
  });
}
