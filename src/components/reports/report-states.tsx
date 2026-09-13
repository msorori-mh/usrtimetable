import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Inbox, ListFilter, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Loading placeholder that mirrors the summary + table rhythm. */
export function ReportLoadingState({ label = "جارٍ تحميل بيانات التقرير…" }: { label?: string }) {
  return (
    <div
      className="min-w-0 space-y-3"
      role="status"
      aria-live="polite"
      data-testid="report-loading-state"
    >
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-3">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-2 h-6 w-12" />
          </Card>
        ))}
      </div>
      <Card className="space-y-2 p-4">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </Card>
    </div>
  );
}

function StateCard({
  icon,
  title,
  body,
  action,
  testId,
  tone = "muted",
}: {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  testId: string;
  tone?: "muted" | "danger";
}) {
  return (
    <Card
      className={
        tone === "danger"
          ? "min-w-0 border-destructive/40 bg-destructive/5 p-6 text-center"
          : "min-w-0 p-6 text-center"
      }
      role={tone === "danger" ? "alert" : undefined}
      data-testid={testId}
    >
      <div className="mx-auto flex max-w-md flex-col items-center gap-2">
        <span
          className={
            tone === "danger"
              ? "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive"
              : "grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
          }
          aria-hidden
        >
          {icon}
        </span>
        <p className="text-sm font-semibold">{title}</p>
        {body && <p className="text-xs text-muted-foreground">{body}</p>}
        {action}
      </div>
    </Card>
  );
}

/** No rows matched the current filters — data source is healthy. */
export function ReportEmptyState({ message, hint }: { message: string; hint?: ReactNode }) {
  return (
    <StateCard
      testId="report-empty-state"
      icon={<Inbox className="h-5 w-5" />}
      title={message}
      body={hint ?? "عدّل الفلاتر أو وسّع نطاق النسخ لعرض نتائج أخرى."}
    />
  );
}

/** The report cannot run yet: a required selection is missing. */
export function ReportNotReadyState({ message, hint }: { message: string; hint?: ReactNode }) {
  return (
    <StateCard
      testId="report-not-ready-state"
      icon={<ListFilter className="h-5 w-5" />}
      title={message}
      body={hint ?? "اختر القيم المطلوبة في منطقة الفلاتر أعلاه ليبدأ التقرير."}
    />
  );
}

/** A query failed: never show partial numbers as if they were complete. */
export function ReportErrorState({
  message = "تعذر تحميل بيانات التقرير.",
  hint,
  onRetry,
}: {
  message?: string;
  hint?: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <StateCard
      testId="report-error-state"
      tone="danger"
      icon={<AlertTriangle className="h-5 w-5" />}
      title={message}
      body={hint ?? "لم تُعرض أرقام جزئية. أعد المحاولة، وإن تكرر الخطأ راجع جاهزية البيانات."}
      action={
        onRetry ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="ml-1 h-4 w-4" /> إعادة المحاولة
          </Button>
        ) : undefined
      }
    />
  );
}
