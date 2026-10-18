import { useRouter } from "@tanstack/react-router";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { userErrorMessage } from "@/lib/user-error";

/**
 * Default error / pending UI for every route. Rendered in place of the failing
 * route's component, so the app shell (sidebar, header) stays visible.
 */
export function RouteErrorState({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter();
  return (
    <div role="alert" className="mx-auto my-10 max-w-xl rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-start">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="space-y-2">
          <h2 className="text-base font-semibold">تعذّر عرض هذه الصفحة</h2>
          <p className="text-sm text-muted-foreground">{userErrorMessage(error, "حدث خطأ غير متوقع.")}</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              reset?.();
              void router.invalidate();
            }}
          >
            <RefreshCw className="me-1 h-4 w-4" aria-hidden="true" /> إعادة المحاولة
          </Button>
        </div>
      </div>
    </div>
  );
}

export function RoutePendingState() {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> جارٍ التحميل…
    </div>
  );
}
