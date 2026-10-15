import { readAllRows } from "@/lib/supabase/read-all";

/** Read every page, propagating failures instead of publishing partial totals. */
export async function readAllReportRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  return readAllRows(page, 500);
}
