import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";

/** Footer for useRowWindow: "عرض المزيد" with a visible count. */
export function ShowMoreRows({
  shown,
  total,
  hasMore,
  onShowMore,
  onShowAll,
}: {
  shown: number;
  total: number;
  hasMore: boolean;
  onShowMore: () => void;
  onShowAll?: () => void;
}) {
  if (!hasMore) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2 border-t p-3 text-xs text-muted-foreground"
      data-testid="show-more-rows"
    >
      <span aria-live="polite">
        يُعرض {formatNumber(shown)} من {formatNumber(total)}
      </span>
      <Button type="button" size="sm" variant="outline" onClick={onShowMore}>
        عرض المزيد
      </Button>
      {onShowAll && (
        <Button type="button" size="sm" variant="ghost" onClick={onShowAll}>
          عرض الكل
        </Button>
      )}
    </div>
  );
}
