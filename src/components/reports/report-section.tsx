import { useId, useMemo, useState, type ReactNode } from "react";
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
  testId,
}: {
  title: string;
  count?: number;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  return (
    <Card className={cn("min-w-0 overflow-hidden", className)} data-testid={testId}>
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
  /** Centered tabular numbers. */
  numeric?: boolean;
  /** Hidden below `md` so small screens keep the primary columns readable. */
  secondary?: boolean;
  /** Disable interactive sorting for presentation-only columns such as row numbers. */
  sortable?: boolean;
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
  minWidthClassName = "min-w-[640px]",
  caption,
  primaryColumnLimit = 6,
}: {
  columns: ReportColumn<T>[];
  rows: T[];
  rowKey?: (row: T, index: number) => string;
  rowClassName?: (row: T, index: number) => string | undefined;
  minWidthClassName?: string;
  caption?: string;
  /** Number of non-secondary columns kept visible on screen before progressive disclosure. */
  primaryColumnLimit?: number;
}) {
  const [sort, setSort] = useState<{ key: string; descending: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<T | null>(null);
  const numericKeys = new Set(
    columns
      .filter(
        (column) =>
          column.numeric ||
          (rows.length > 0 &&
            rows.every((row) => typeof (row as Record<string, unknown>)[column.key] === "number")),
      )
      .map((column) => column.key),
  );
  const pageSize = 25;
  const sorted = useMemo(() => {
    const indexed = rows.map((row, index) => ({ row, index }));
    if (!sort) return indexed;
    const collator = new Intl.Collator("ar", { numeric: true, sensitivity: "base" });
    return indexed.sort((a, b) => {
      const left = (a.row as Record<string, unknown>)[sort.key];
      const right = (b.row as Record<string, unknown>)[sort.key];
      const value =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : collator.compare(String(left ?? ""), String(right ?? ""));
      return (sort.descending ? -value : value) || a.index - b.index;
    });
  }, [rows, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const primary = columns.filter((c) => !c.secondary).slice(0, primaryColumnLimit);
  const visible = showAll ? columns : primary;
  const details = columns.filter((c) => !visible.includes(c));
  const cell = (c: ReportColumn<T>, row: T, index: number) =>
    c.render ? c.render(row, index) : String((row as Record<string, unknown>)[c.key] ?? "—");
  const renderTable = (print: boolean) => {
    const cols = print ? columns : visible;
    const records = print
      ? sorted
      : sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
    return (
      <Table className={minWidthClassName}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <TableHeader className="sticky top-0 z-10 bg-card print:static">
          <TableRow>
            {cols.map((c) => (
              <TableHead
                key={c.key}
                scope="col"
                aria-sort={
                  sort?.key === c.key ? (sort.descending ? "descending" : "ascending") : undefined
                }
                className={cn(
                  "whitespace-nowrap",
                  numericKeys.has(c.key) && "report-numeric-cell tabular-nums text-center",
                  c.className,
                )}
              >
                {print || c.sortable === false ? (
                  <span className="font-semibold">{c.label}</span>
                ) : (
                  <button
                    type="button"
                    className={cn(
                      "py-3 font-semibold hover:text-primary",
                      numericKeys.has(c.key) ? "text-center" : "text-start",
                    )}
                    onClick={() => {
                      setSort({ key: c.key, descending: sort?.key === c.key && !sort.descending });
                      setPage(0);
                    }}
                  >
                    {c.label}{" "}
                    <span aria-hidden>
                      {sort?.key === c.key ? (sort.descending ? "↓" : "↑") : "↕"}
                    </span>
                  </button>
                )}
              </TableHead>
            ))}
            {!print && details.length > 0 && <TableHead>التفاصيل</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map(({ row, index }) => (
            <TableRow
              key={rowKey ? rowKey(row, index) : index}
              className={cn(index % 2 === 1 && "bg-muted/30", rowClassName?.(row, index))}
            >
              {cols.map((c) => (
                <TableCell
                  key={c.key}
                  className={cn(
                    "py-3 align-top text-sm",
                    numericKeys.has(c.key) && "report-numeric-cell tabular-nums text-center",
                    c.className,
                  )}
                >
                  {cell(c, row, index)}
                </TableCell>
              ))}
              {!print && details.length > 0 && (
                <TableCell>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-expanded={expanded === row}
                    onClick={() => setExpanded(expanded === row ? null : row)}
                  >
                    التفاصيل
                  </Button>
                  {expanded === row && (
                    <dl className="min-w-56 space-y-3 py-3">
                      {details.map((c) => (
                        <div key={c.key}>
                          <dt className="text-xs text-muted-foreground">{c.label}</dt>
                          <dd className="mt-1 text-sm">{cell(c, row, index)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };
  return (
    <div className="report-data-table min-w-0">
      <div className="report-no-print flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-sm">
        <span aria-live="polite">{rows.length} سجل</span>
        {columns.length > primary.length && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={showAll}
            onClick={() => setShowAll(!showAll)}
          >
            {showAll ? "الأعمدة الأساسية" : "جميع الأعمدة"}
          </Button>
        )}
      </div>
      <div className="report-no-print max-h-[70vh] overflow-auto">{renderTable(false)}</div>
      <div className="hidden print:block">{renderTable(true)}</div>
      {pages > 1 && (
        <nav
          aria-label="صفحات نتائج التقرير"
          className="report-no-print flex items-center justify-between gap-3 border-t p-3"
        >
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            السابق
          </Button>
          <span className="text-sm" aria-live="polite">
            صفحة {currentPage + 1} من {pages} · {pageSize} سجلًا في الصفحة
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage + 1 >= pages}
            onClick={() => setPage(currentPage + 1)}
          >
            التالي
          </Button>
        </nav>
      )}
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
