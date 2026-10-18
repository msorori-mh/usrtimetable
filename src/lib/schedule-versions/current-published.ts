/**
 * "The" published timetable of a college and term (M-9). The server function
 * public.current_published_version is the single source of truth (also used by
 * delivery_group_shared_in_published); publishing archives the superseded version, and a
 * unique index guards one published version per college and term.
 */
import { supabase } from "@/integrations/supabase/client";

type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

/** term id → current published version id (terms without a publication are omitted). */
export async function fetchCurrentPublishedVersions(
  collegeId: string,
  termIds: readonly string[],
): Promise<Map<string, string>> {
  const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
  const out = new Map<string, string>();
  const unique = [...new Set(termIds.filter(Boolean))];
  const results = await Promise.all(
    unique.map((termId) =>
      rpc("current_published_version", { p_college_id: collegeId, p_term_id: termId }),
    ),
  );
  results.forEach(({ data, error }, i) => {
    if (error) throw new Error(`تعذر تحديد النسخة المنشورة الحالية: ${error.message}`);
    if (typeof data === "string" && data) out.set(unique[i], data);
  });
  return out;
}

/** Keep only the current published version of each term (pure). */
export function onlyCurrentPublished<T extends { id: string; academic_term_id: string }>(
  versions: readonly T[],
  current: ReadonlyMap<string, string>,
): T[] {
  return versions.filter((v) => current.get(v.academic_term_id) === v.id);
}
