import { useId, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/** Titled content card: heading, optional row counter and one short hint line. */
export function ReportSection({
  title,
  count,
  hint,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  count?: number;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-border/60 px-4 py-3 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <h2 className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
            <span className="truncate">{title}</span>
            {typeof count === "number" && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                {count}
              </span>
            )}
          </h2>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
      <div className={cn("min-w-0", bodyClassName)}>{children}</div>
    </Card>
  );
}

export interface ReportColumn<T> {
  key: string;
  label: string;
  /** Right-aligned tabular numbers. */
  numeric?: boolean;
  /** Hidden below `md` so small screens keep the primary columns readable. */
  secondary?: boolean;
  className?: string;
  render?: (row: T, index: number) => ReactNode;
}

/**
 * Shared detail table: sticky header, subtle zebra rows, comfortable spacing,
 * numeric alignment, and secondary columns that fold away on small screens.
 * Print CSS (`.report-print-body`) restores full borders and repeats the header.
 */
export function ReportDataTable<T>({
  columns,
  rows,
  rowKey,
  rowClassName,
  minWidthClassName = "min-w-[720px]",
  caption,
}: {
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey?: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string | undefined;
  minWidthClassName?: string;
  caption?: string;
}) {
  return (
    <div className="report-data-table min-w-0 max-h-[70vh] overflow-auto print:max-h-none print:overflow-visible">
      <Table className={minWidthClassName}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_var(--color-border)] print:static">
          <TableRow>
            {columns.map((c) => (
              <TableHead
                key={c.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap",
                  c.numeric && "text-start tabular-nums",
                  c.secondary && "hidden md:table-cell print:table-cell",
                  c.className,
                )}
              >
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={rowKey ? rowKey(row, index) : index}
              className={cn(index % 2 === 1 && "bg-muted/30", rowClassName?.(row, index))}
            >
              {columns.map((c) => (
                <TableCell
                  key={c.key}
                  className={cn(
                    "py-3 align-top",
                    c.numeric && "tabular-nums",
                    c.secondary && "hidden md:table-cell print:table-cell",
                    c.className,
                  )}
                >
                  {c.render
                    ? c.render(row, index)
                    : String((row as Record<string, unknown>)[c.key] ?? "—")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Progressive disclosure for secondary detail — never deletes data. */
export function ReportDisclosure({
  label,
  children,
  defaultOpen = false,
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="min-w-0" data-testid="report-disclosure">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
      >
        {label}
        <ChevronDown
          className={cn("ms-1 h-4 w-4 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </Button>
      <div id={id} hidden={!open} className="mt-2 min-w-0">
        {children}
      </div>
    </div>
  );
}
