import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

// Additive RPC contract until the next generated schema refresh.
type FacultyDatabase = Database & {
  public: {
    Functions: {
      get_instructor_university_numbers: {
        Args: { p_instructor_ids: string[] };
        Returns: { instructor_id: string; identity_id: string; university_number: string }[];
      };
      link_verified_faculty_identity: {
        Args: { p_instructor_id: string; p_university_number: string };
        Returns: undefined;
      };
    };
  };
};
export const facultyClient = supabase as unknown as SupabaseClient<FacultyDatabase>;

/** Numbers live outside operational instructor rows to preserve schedule revisions. */
export async function withUniversityNumbers<T extends { id: string }>(rows: T[]) {
  const numbers = new Map<string, string>();
  for (let offset = 0; offset < rows.length; offset += 200) {
    const { data, error } = await facultyClient.rpc("get_instructor_university_numbers", {
      p_instructor_ids: rows.slice(offset, offset + 200).map((row) => row.id),
    });
    if (error) throw error;
    for (const row of data ?? []) numbers.set(row.instructor_id, row.university_number);
  }
  return rows.map((row) => ({ ...row, university_number: numbers.get(row.id) ?? null }));
}
