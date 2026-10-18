/**
 * Presentational parts of the university leadership dashboard
 * (moved from routes/_authenticated/reports.leadership.tsx — L-14 size split,
 * no behaviour change).
 */
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LeadershipCollege } from "@/lib/reports/leadership";
import { LEADERSHIP_METRICS, type LeadershipMetricKey } from "@/lib/reports/leadership-metrics";
import { formatNumber } from "@/lib/format";

export function MetricCard({
  label,
  value,
  detail,
  icon,
  tone = "normal",
  definition,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: ReactNode;
  tone?: "normal" | "warning" | "critical";
  definition?: string;
  onOpen?: () => void;
}) {
  const valueClass =
    tone === "critical"
      ? "mt-1 text-xl font-bold text-destructive"
      : tone === "warning"
        ? "mt-1 text-xl font-bold text-[color:var(--usr-gold-dark)]"
        : "mt-1 text-xl font-bold text-foreground";
  return (
    <Card className="min-w-0 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className={`${valueClass} cursor-pointer text-start underline decoration-dotted underline-offset-4`}
              aria-label={`فتح سجلات ${label}`}
            >
              {value}
            </button>
          ) : (
            <div className={valueClass}>{value}</div>
          )}
        </div>
        <span className="rounded border bg-muted p-2 text-muted-foreground" aria-hidden>
          {icon}
        </span>
      </div>
      {definition && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">كيف حُسب؟</summary>
          <p className="mt-2 leading-6">{definition}</p>
        </details>
      )}
      <div className="mt-3 border-t pt-2 text-xs leading-6 text-muted-foreground">{detail}</div>
    </Card>
  );
}

/** رقم فرعي قابل للفتح إلى سجلاته مع تعريفه المركزي. */
export function MetricLink({
  metric,
  value,
  onOpen,
}: {
  metric: LeadershipMetricKey;
  value: ReactNode;
  onOpen: (metric: LeadershipMetricKey) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(metric)}
      title={LEADERSHIP_METRICS[metric].definition}
      className="cursor-pointer underline decoration-dotted underline-offset-4"
      aria-label={`فتح سجلات ${LEADERSHIP_METRICS[metric].label}`}
    >
      {value}
    </button>
  );
}

export type FacultyBreakdownTone = "availability" | "rank";

const FACULTY_BREAKDOWN_STYLES: Record<
  FacultyBreakdownTone,
  { panel: string; heading: string; item: string; value: string; total: string }
> = {
  availability: {
    panel: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/25",
    heading: "border-emerald-200/80 dark:border-emerald-900",
    item: "border-emerald-100 bg-white/90 dark:border-emerald-900/70 dark:bg-background/75",
    value: "bg-emerald-600 text-white shadow-sm dark:bg-emerald-500 dark:text-emerald-950",
    total: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100",
  },
  rank: {
    panel: "border-indigo-200 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/25",
    heading: "border-indigo-200/80 dark:border-indigo-900",
    item: "border-indigo-100 bg-white/90 dark:border-indigo-900/70 dark:bg-background/75",
    value: "bg-indigo-600 text-white shadow-sm dark:bg-indigo-500 dark:text-indigo-950",
    total: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-100",
  },
};

export function CountList({
  entries,
  tone,
}: {
  entries: Array<[string, number]>;
  tone: FacultyBreakdownTone;
}) {
  const styles = FACULTY_BREAKDOWN_STYLES[tone];
  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
      {entries.map(([label, value]) => (
        <div
          key={label}
          className={`grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2 ${styles.item}`}
        >
          <dt className="min-w-0 text-sm font-medium leading-5 text-foreground">{label}</dt>
          <dd
            className={`min-w-12 rounded-md px-2.5 py-1 text-center text-base font-extrabold tabular-nums ${styles.value}`}
          >
            {formatNumber(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function FacultyBreakdownPanel({
  title,
  entries,
  testId,
  tone,
}: {
  title: string;
  entries: Array<[string, number]>;
  testId: string;
  tone: FacultyBreakdownTone;
}) {
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  const styles = FACULTY_BREAKDOWN_STYLES[tone];
  return (
    <section
      className={`rounded-xl border p-3.5 shadow-sm ${styles.panel}`}
      aria-label={title}
      data-testid={testId}
    >
      <div
        className={`mb-3 flex items-center justify-between gap-3 border-b pb-2.5 ${styles.heading}`}
      >
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
        <span className={`rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${styles.total}`}>
          المجموع {formatNumber(total)}
        </span>
      </div>
      <CountList entries={entries} tone={tone} />
    </section>
  );
}

export function StatusBadge({ row }: { row: LeadershipCollege }) {
  if (row.term_state !== "ready") return <Badge variant="outline">الفترة غير مكتملة</Badge>;
  return row.version_id ? (
    <Badge variant="default">منشور</Badge>
  ) : (
    <Badge variant="secondary">غير منشور</Badge>
  );
}
