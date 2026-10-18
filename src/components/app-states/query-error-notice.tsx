import { useMemo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { userErrorMessage } from "@/lib/user-error";

/**
 * Inline error state for a failed read (M-21). Shown instead of an empty list so
 * a failed query is never mistaken for "no data".
 */
export function QueryErrorNotice({
  error,
  onRetry,
  title = "تعذّر تحميل البيانات.",
  className = "",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
  className?: string;
}) {
  // Memoised so the logged support reference does not change on every render.
  const message = useMemo(() => userErrorMessage(error), [error]);
  return (
    <div
      role="alert"
      data-testid="query-error-notice"
      className={`flex flex-wrap items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-start text-sm ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold text-destructive">{title}</p>
        <p className="text-xs text-muted-foreground">{message}</p>
      </div>
      {onRetry && (
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          <RefreshCw className="me-1 h-4 w-4" aria-hidden="true" /> إعادة المحاولة
        </Button>
      )}
    </div>
  );
}
