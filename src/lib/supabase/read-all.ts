/**
 * Shared paginated reader for Supabase/PostgREST queries.
 *
 * PostgREST silently caps responses (1000 rows by default). Any query whose
 * result can grow with a college, a term or a schedule version MUST be read
 * through this helper, so callers never compute metrics, conflicts or
 * eligibility on a truncated list.
 *
 * Usage:
 *   const rows = await readAllRows((from, to) =>
 *     supabase.from("schedule_sessions").select("id, room_id")
 *       .eq("schedule_version_id", id).order("id").range(from, to));
 *
 * The page callback must apply a deterministic `.order(...)` so pages do not
 * overlap or skip rows.
 */
export const READ_ALL_PAGE_SIZE = 1000;

export async function readAllRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize: number = READ_ALL_PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await page(from, from + pageSize - 1);
    if (result.error) throw result.error;
    if (!result.data) throw new Error("تعذر قراءة البيانات كاملة");
    rows.push(...result.data);
    if (result.data.length < pageSize) return rows;
  }
}

/**
 * Throws when a query returned fewer rows than the exact count reported by the
 * server — i.e. the result was truncated. Use with `{ count: "exact" }` on
 * queries that are not paginated through `readAllRows`.
 */
export function assertComplete<T>(
  result: { data: T[] | null; count?: number | null },
  label: string,
): T[] {
  const data = result.data ?? [];
  if (typeof result.count === "number" && result.count > data.length) {
    throw new Error(`نتيجة ناقصة (${label}): ${data.length} من ${result.count}`);
  }
  return data;
}

/** Splits a list of ids into chunks small enough for `.in(...)` filters in a URL. */
export function chunkIds<T>(ids: readonly T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/**
 * Same as readAllRows, but returns `{ data, error }` like a Supabase call so it can
 * replace a builder inside an existing `Promise.all([...])` without restructuring.
 */
export async function readAllResult<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize: number = READ_ALL_PAGE_SIZE,
): Promise<{ data: T[] | null; error: unknown }> {
  try {
    return { data: await readAllRows(page, pageSize), error: null };
  } catch (error) {
    return { data: null, error };
  }
}
