import { supabase } from "@/integrations/supabase/client";

/** Numbers live outside operational instructor rows to preserve schedule revisions. */
export async function withUniversityNumbers<T extends { id: string }>(rows: T[]) {
  const numbers = new Map<string, string>();
  for (let offset = 0; offset < rows.length; offset += 200) {
    const { data, error } = await supabase.rpc("get_instructor_university_numbers", {
      p_instructor_ids: rows.slice(offset, offset + 200).map((row) => row.id),
    });
    if (error) throw error;
    for (const row of data ?? []) numbers.set(row.instructor_id, row.university_number);
  }
  return rows.map((row) => ({ ...row, university_number: numbers.get(row.id) ?? null }));
}
