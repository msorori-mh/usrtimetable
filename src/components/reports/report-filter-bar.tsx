import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface ReportFilterBarProps {
  /** Always-visible essential filters (term / version / main entity). */
  basic: ReactNode;
  /** Secondary filters, collapsed by default. */
  advanced?: ReactNode;
  /** Free-text search over the visible rows. */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /** Human-readable list of the filters currently applied. */
  activeSummary?: string[];
  /** Single reset action; hidden when nothing is resettable. */
  onClear?: () => void;
}

/**
 * Unified, screen-only filter area: essentials in view, everything else behind a
 * disclosure, plus one clear summary of what is currently applied.
 */
export function ReportFilterBar({
  basic,
  advanced,
  search,
  activeSummary,
  onClear,
}: ReportFilterBarProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const chips = (activeSummary ?? []).filter(Boolean);

  return (
    <Card className="report-no-print min-w-0 space-y-3 overflow-hidden p-4" data-testid="report-filter-bar">
      {search && (
        <div className="relative min-w-0">
          <Search className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder ?? "ابحث في نتائج التقرير…"}
            aria-label="بحث في نتائج التقرير"
            className="pe-9"
          />
        </div>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">{basic}</div>

      {advanced && (
        <div className="min-w-0 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            data-testid="report-advanced-filters-toggle"
          >
            <SlidersHorizontal className="ml-1 h-4 w-4" />
            فلاتر متقدمة
            <ChevronDown
              className={cn("ms-1 h-4 w-4 transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </Button>
          <div
            id={panelId}
            hidden={!open}
            data-testid="report-advanced-filters-panel"
            className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4"
          >
            {advanced}
          </div>
        </div>
      )}

      {(chips.length > 0 || onClear) && (
        <div
          className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border/60 pt-3"
          data-testid="report-active-filters"
        >
          <span className="text-xs text-muted-foreground">الفلاتر النشطة:</span>
          {chips.length ? (
            chips.map((chip) => (
              <Badge key={chip} variant="outline" className="max-w-full truncate font-normal">
                {chip}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">لا فلاتر مطبّقة.</span>
          )}
          {onClear && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="ms-auto"
              onClick={onClear}
              aria-label="مسح كل الفلاتر"
            >
              <X className="ml-1 h-4 w-4" /> مسح الفلاتر
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/** Labelled filter control used inside the basic/advanced slots. */
export function ReportFilterField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
