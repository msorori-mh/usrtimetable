/**
 * L-14: React keys for list items that have no id of their own (conflict lists,
 * import preview rows). Keys derive from the item's content, so a re-ordered or
 * filtered list keeps each row's identity; exact duplicates get a #n suffix.
 */
export function withStableKeys<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): { key: string; item: T }[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const base = keyOf(item);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { key: n === 0 ? base : `${base}#${n}`, item };
  });
}
