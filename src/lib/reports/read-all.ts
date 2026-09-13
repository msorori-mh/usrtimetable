/** Read every page, propagating failures instead of publishing partial totals. */
export async function readAllReportRows<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const result = await page(from, from + size - 1);
    if (result.error) throw result.error;
    if (!result.data) throw new Error("تعذر قراءة بيانات التقرير كاملة");
    rows.push(...result.data);
    if (result.data.length < size) return rows;
  }
}
