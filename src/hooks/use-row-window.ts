import { useEffect, useMemo, useState } from "react";

/**
 * L-14: client-side row windowing for long lists when no virtualization library
 * is available. Renders the first `pageSize` rows and grows by `pageSize` on
 * demand; resets when the underlying list identity/length changes (new filter).
 */
export function useRowWindow<T>(rows: readonly T[], pageSize = 100) {
  const [limit, setLimit] = useState(pageSize);
  useEffect(() => {
    setLimit(pageSize);
  }, [rows, pageSize]);
  const visible = useMemo(() => rows.slice(0, limit), [rows, limit]);
  return {
    visible,
    total: rows.length,
    shown: visible.length,
    hasMore: rows.length > limit,
    showMore: () => setLimit((n) => n + pageSize),
    showAll: () => setLimit(rows.length),
  };
}
