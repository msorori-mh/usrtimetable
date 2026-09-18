import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";

// Additive RPC contract until the next generated schema refresh.
type FacultyDatabase = Database & {
  public: {
    Functions: {
      link_faculty_identity_with_evidence: {
        Args: {
          p_instructor_id: string;
          p_university_number: string;
          p_evidence: string;
        };
        Returns: undefined;
      };
      get_instructor_number_aliases: {
        Args: { p_instructor_ids: string[] };
        Returns: { instructor_id: string; university_number: string }[];
      };
      get_instructor_university_numbers: {
        Args: { p_instructor_ids: string[] };
        Returns: {
          instructor_id: string;
          identity_id: string;
          university_number: string;
        }[];
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
  const aliases = new Map<string, string[]>();
  for (let offset = 0; offset < rows.length; offset += 200) {
    const { data, error } = await facultyClient.rpc("get_instructor_university_numbers", {
      p_instructor_ids: rows.slice(offset, offset + 200).map((row) => row.id),
    });
    if (error) throw error;
    const history = await facultyClient.rpc("get_instructor_number_aliases", {
      p_instructor_ids: rows.slice(offset, offset + 200).map((row) => row.id),
    });
    if (history.error) throw history.error;
    for (const row of history.data ?? []) {
      aliases.set(row.instructor_id, [
        ...(aliases.get(row.instructor_id) ?? []),
        row.university_number,
      ]);
    }
    for (const row of data ?? []) numbers.set(row.instructor_id, row.university_number);
  }
  return rows.map((row) => ({
    ...row,
    university_number: numbers.get(row.id) ?? null,
    university_number_aliases: aliases.get(row.id) ?? [],
  }));
}
