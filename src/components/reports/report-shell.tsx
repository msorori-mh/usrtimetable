import { RepeatingPrintHeader } from "@/components/reports/repeating-print-header";
import { ReportScopeError } from "@/lib/reports/preferences";
import { ReactNode, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { ArrowRight, Download, FileSpreadsheet, Printer } from "lucide-react";
import {
  ReportOfficialHeader,
  headerMetaFromContext,
  type ReportOfficialHeaderMeta,
} from "@/components/reports/report-official-header";
import { ReportKpiRow, type ReportKpi } from "@/components/reports/report-kpis";
import {
  ReportEmptyState,
  ReportErrorState,
  ReportLoadingState,
  ReportNotReadyState,
} from "@/components/reports/report-states";
import { useActiveCollege } from "@/hooks/use-colleges";
import { downloadCSV, downloadXLSX, type Row } from "@/lib/reports/export";
import { printPageStyleCss } from "@/lib/print-center";
import { toast } from "sonner";
import type { ReportContext } from "@/lib/reports/types";

interface Props {
  title: string;
  shareParams?: Record<string, string | null | undefined>;
  description?: string;
  /** Active unified filter summary from ReportContext. */
  filterSummary?: string;
  /** When set, official header fields are derived automatically. */
  reportContext?: ReportContext | null;
  /** Override or extend header metadata. */
  headerMeta?: ReportOfficialHeaderMeta;
  /** Official published report badge on header. */
  official?: boolean;
  /** Read-only note on header (default true). */
  readOnly?: boolean;
  filters?: ReactNode;
  /** Screen-only KPI strip (3–5 meaningful indicators). */
  kpis?: ReportKpi[];
  /** Summary block rendered above the detail tables. */
  summary?: ReactNode;
  /** Always rendered above the loading/empty/body area (e.g. delivery-demo warning). */
  leading?: ReactNode;
  rows: Row[];
  headers: { key: string; label: string }[];
  filename: string;
  /** Human-readable default filename used by browser Save as PDF. */
  printFilename?: string;
  children?: ReactNode;
  /** Dedicated printable schedule; screen report remains available for inspection. */
  printContent?: ReactNode;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Query failure — shows the error state instead of an empty result. */
  error?: unknown;
  /** Retry handler offered by the error state. */
  onRetry?: () => void;
  /** Required selections still missing — shows the not-ready state. */
  notReadyMessage?: string;
}

export function ReportShell({
  title,
  shareParams,
  description,
  filterSummary,
  reportContext,
  headerMeta: headerMetaProp,
  official,
  readOnly = true,
  filters,
  kpis,
  summary,
  leading,
  rows,
  headers,
  filename,
  printFilename,
  children,
  printContent,
  isLoading,
  emptyMessage,
  error,
  onRetry,
  notReadyMessage,
}: Props) {
  const { active } = useActiveCollege();
  const [printSnapshot, setPrintSnapshot] = useState<ReactNode>(null);

  const headerMeta = useMemo((): ReportOfficialHeaderMeta => {
    const fromCtx = reportContext ? headerMetaFromContext(reportContext) : {};
    return {
      ...fromCtx,
      ...headerMetaProp,
      termName:
        headerMetaProp?.termName ??
        reportContext?.terms.find((t) => t.id === reportContext.termId)?.name,
      collegeName: headerMetaProp?.collegeName ?? active?.name ?? null,
      official: headerMetaProp?.official ?? official,
      readOnly: headerMetaProp?.readOnly ?? readOnly,
    };
  }, [reportContext, headerMetaProp, active?.name, official, readOnly]);

  const handlePrint = async () => {
    if (exportsDisabled) return;
    // Keep the complete authorized render stable while focus/refetch events run.
    setPrintSnapshot(
      printContent ?? (
        <RepeatingPrintHeader
          header={
            <ReportOfficialHeader
              reportTitle={title}
              description={description}
              filterSummary={filterSummary}
              qrUrl={qrUrl}
              {...headerMeta}
            />
          }
        >
          {leading}
          {summary}
          <div className="report-print-body min-w-0">{children}</div>
        </RepeatingPrintHeader>
      ),
    );
    // A slow web-font host must not prevent printing with the fallback font.
    let fontTimer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      document.fonts.ready.catch(() => undefined),
      new Promise<void>((resolve) => {
        fontTimer = setTimeout(resolve, 2000);
      }),
    ]);
    clearTimeout(fontTimer);

    const originalTitle = document.title;
    const pdfTitle =
      (printFilename ?? title ?? filename)
        .replace(/[\\/:*?"<>|]+/g, " - ")
        .replace(/\s+/g, " ")
        .trim() || originalTitle;
    let restored = false;
    const restoreTitle = () => {
      if (restored) return;
      restored = true;
      document.title = originalTitle;
      setPrintSnapshot(null);
      window.removeEventListener("afterprint", restoreTitle);
    };

    document.title = pdfTitle;
    window.addEventListener("afterprint", restoreTitle, { once: true });

    // Let the browser observe the temporary document title before opening print preview.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    try {
      window.print();
    } catch {
      restoreTitle();
      toast.error("تعذّر فتح نافذة الطباعة. أعد المحاولة.");
    }
    // Do not discard the printable snapshot on a timer: some browsers return
    // from print() while their preview is still open. afterprint owns cleanup.
  };

  /**
   * Real verification/report URL for the header QR: the current report URL with its
   * active filters. Resolved after hydration so SSR markup stays stable.
   */
  const [pageUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    setQrUrl(window.location.href);
  }, []);

  const qrUrl = useMemo(() => {
    if (!pageUrl) return null;
    const url = new URL(pageUrl);
    const params = {
      ...(reportContext
        ? {
            collegeId: reportContext.collegeId,
            termId: reportContext.termId,
            versionId: reportContext.versionId,
            statusMode: reportContext.statusMode,
            studySystem: reportContext.studySystem,
          }
        : {}),
      ...shareParams,
    };
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    return url.toString();
  }, [pageUrl, reportContext, shareParams]);

  const hasRows = rows.length > 0;
  const exportsDisabled = !hasRows || !!isLoading || !!error || !!notReadyMessage;

  /** One state machine: error → not ready → loading → empty → content. */
  const body = error ? (
    <ReportErrorState
      message={error instanceof ReportScopeError ? error.message : undefined}
      onRetry={onRetry}
    />
  ) : notReadyMessage ? (
    <ReportNotReadyState message={notReadyMessage} />
  ) : isLoading ? (
    <ReportLoadingState />
  ) : !hasRows ? (
    <ReportEmptyState message={emptyMessage ?? "لا توجد بيانات بهذه المعايير."} />
  ) : (
    children
  );

  const showSummaryBlocks = !error && !notReadyMessage && !isLoading;

  return (
    <div className="report-print-root min-w-0 space-y-4" dir="rtl">
      {/* A4 RTL portrait page box for reports that print the on-screen body.
          Dedicated printContent sheets inject their own page style. */}
      {!printContent && <style>{printPageStyleCss()}</style>}

      <header className="report-no-print flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div className="min-w-0">
          <p className="mb-1 text-sm text-muted-foreground">{headerMeta.collegeName}</p>
          <h1 className="text-2xl font-bold leading-relaxed text-primary">{title}</h1>
          {description && (
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {headerMeta.versionStatus && (
          <span className="rounded-full border px-3 py-1 text-sm font-medium">
            {headerMeta.versionStatus === "published"
              ? "منشور"
              : headerMeta.versionStatus === "draft"
                ? "مسودة — للمراجعة"
                : "نسخة قيد المراجعة"}
          </span>
        )}
      </header>
      {/* Quiet, unified action bar: print carries the visual priority. */}
      <div
        className="report-no-print grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between"
        data-testid="report-action-bar"
      >
        <Button asChild variant="ghost" size="sm" className="justify-self-start">
          <Link to="/reports" aria-label="العودة إلى فهرس التقارير">
            <ArrowRight className="ml-1 h-4 w-4" /> العودة
          </Link>
        </Button>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            onClick={handlePrint}
            aria-label="طباعة التقرير"
            disabled={exportsDisabled}
          >
            <Printer className="ml-1 h-4 w-4" /> طباعة
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="تصدير Excel"
            disabled={exportsDisabled}
            onClick={() => downloadXLSX(rows, headers, filename)}
          >
            <FileSpreadsheet className="ml-1 h-4 w-4" /> Excel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="تصدير CSV"
            disabled={exportsDisabled}
            onClick={() => downloadCSV(rows, headers, filename)}
          >
            <Download className="ml-1 h-4 w-4" /> CSV
          </Button>
        </div>
      </div>

      {filters}

      {showSummaryBlocks && kpis && kpis.length > 0 && <ReportKpiRow items={kpis} />}

      {printContent ? (
        <div className="report-no-print space-y-4">
          {leading}
          {showSummaryBlocks && summary}
          <div className="min-w-0">{body}</div>
        </div>
      ) : (
        <div className={printSnapshot ? "report-no-print" : undefined}>
          <RepeatingPrintHeader
            header={
              <div className="hidden print:block">
                <ReportOfficialHeader
                  reportTitle={title}
                  description={description}
                  filterSummary={filterSummary}
                  qrUrl={qrUrl}
                  {...headerMeta}
                />
              </div>
            }
          >
            {leading}
            {showSummaryBlocks && summary}
            <div className="report-print-body min-w-0">{body}</div>
          </RepeatingPrintHeader>
        </div>
      )}
      {printSnapshot ? (
        <div className="hidden print:block print-center-body" data-testid="report-print-snapshot">
          {printSnapshot}
        </div>
      ) : (
        printContent &&
        showSummaryBlocks &&
        hasRows && <div className="hidden print:block print-center-body">{printContent}</div>
      )}
    </div>
  );
}
