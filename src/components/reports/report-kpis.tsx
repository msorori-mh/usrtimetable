import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ReportKpiTone = "neutral" | "accent" | "warning" | "danger" | "success";

export interface ReportKpi {
  /** Short label — two or three words at most. */
  label: string;
  /** Big value. Numbers stay LTR-safe via tabular numerals. */
  value: ReactNode;
  /** Optional one-line clarification under the number. */
  hint?: string;
  tone?: ReportKpiTone;
}

const TONE_CLASS: Record<ReportKpiTone, string> = {
  neutral: "text-foreground",
  accent: "text-primary",
  warning: "text-[color:var(--usr-gold-dark)]",
  danger: "text-destructive",
  success: "text-primary",
};

/**
 * Screen-only summary strip. Max five meaningful indicators — never render an
 * empty or placeholder card, callers filter the list before passing it in.
 * Print sheets carry their own official header, so this row is `report-no-print`.
 */
export function ReportKpiRow({ items, className }: { items: ReportKpi[]; className?: string }) {
  const visible = items.slice(0, 5);
  if (!visible.length) return null;
  return (
    <div
      className={cn(
        "report-no-print grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(160px,1fr))]",
        className,
      )}
      data-testid="report-kpi-row"
      aria-label="ملخص المؤشرات"
    >
      {visible.map((kpi) => (
        <Card key={kpi.label} className="min-w-0 p-3">
          <p className="text-sm text-muted-foreground">{kpi.label}</p>
          <p
            className={cn(
              "mt-1 text-2xl font-bold tabular-nums leading-tight",
              TONE_CLASS[kpi.tone ?? "neutral"],
            )}
          >
            {kpi.value}
          </p>
          {kpi.hint && <p className="mt-0.5 text-xs text-muted-foreground">{kpi.hint}</p>}
        </Card>
      ))}
    </div>
  );
}
