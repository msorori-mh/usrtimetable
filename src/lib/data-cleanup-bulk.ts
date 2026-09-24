/**
 * Pure helpers for the data-cleanup bulk dialog (selection + confirm contract).
 * Kept framework-free so the behaviour can be tested without a DOM.
 */
export type BulkItem = {
  id: string;
  /** Primary line: human name / code. */
  title: string;
  /** Secondary line: current values and the reason for the fix. */
  details?: string;
};

/** Every item selected — used whenever the controlled dialog opens or its items change. */
export function selectAll(items: readonly BulkItem[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  for (const it of items) next[it.id] = true;
  return next;
}

export function selectedIds(
  items: readonly BulkItem[],
  selected: Record<string, boolean>,
): string[] {
  return items.filter((it) => selected[it.id]).map((it) => it.id);
}

/**
 * Runs the confirm handler. Resolves true only when the handler explicitly
 * reports success; thrown errors are reported and treated as failure so the
 * dialog stays open.
 */
export async function runBulkConfirm(
  onConfirm: (ids: string[]) => Promise<boolean> | boolean,
  ids: string[],
  onError: (message: string) => void,
): Promise<boolean> {
  try {
    return (await onConfirm(ids)) === true;
  } catch (e) {
    const msg = e instanceof Error && e.message ? e.message : String(e);
    onError(`تعذّر تنفيذ العملية: ${msg}`);
    return false;
  }
}

/** Short secondary reference for a record that has no readable name. */
export function shortRef(id: string): string {
  return `مرجع ${id.slice(0, 8)}`;
}

/** Collects query errors instead of silently turning them into empty lists. */
export function firstQueryError(
  results: ReadonlyArray<{ label: string; error: { message?: string } | null }>,
): string | null {
  const failed = results.filter((r) => r.error);
  if (failed.length === 0) return null;
  return `تعذّر تحميل البيانات (${failed.map((f) => f.label).join("، ")}): ${failed[0].error?.message ?? "خطأ غير معروف"}`;
}
