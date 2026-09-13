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
import type { ReportContext } from "@/lib/reports/types";

interface Props {
  title: string;
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
  children,
  printContent,
  isLoading,
  emptyMessage,
  error,
  onRetry,
  notReadyMessage,
}: Props) {
  const { active } = useActiveCollege();

  const headerMeta = useMemo((): ReportOfficialHeaderMeta => {
    const fromCtx = reportContext ? headerMetaFromContext(reportContext) : {};
    return {
      ...fromCtx,
      ...headerMetaProp,
      collegeName: headerMetaProp?.collegeName ?? active?.name ?? null,
      official: headerMetaProp?.official ?? official,
      readOnly: headerMetaProp?.readOnly ?? readOnly,
    };
  }, [reportContext, headerMetaProp, active?.name, official, readOnly]);

  const handlePrint = () => window.print();

  /**
   * Real verification/report URL for the header QR: the current report URL with its
   * active filters. Resolved after hydration so SSR markup stays stable.
   */
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  useEffect(() => {
    setQrUrl(window.location.href);
  }, []);

  const hasRows = rows.length > 0;
  const exportsDisabled = !hasRows || !!isLoading || !!error;

  /**
   * PUBLISHED-ONLY-REPORTS-01 — for the reports-only viewer a college/term without a
   * published version shows an explicit not-ready state; never a draft fallback.
   */
  const noPublishedVersion =
    !!reportContext?.publishedOnly && !reportContext.isLoading && !reportContext.versionId;
  const effectiveNotReady = noPublishedVersion
    ? NO_PUBLISHED_VERSION_MESSAGE_AR
    : notReadyMessage;

  /** One state machine: error → not ready → loading → empty → content. */
  const body = error ? (
    <ReportErrorState onRetry={onRetry} />
  ) : effectiveNotReady ? (
    <ReportNotReadyState message={effectiveNotReady} />
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
      {!printContent && <style>{printPageStyleCss("A4", "portrait")}</style>}

      <div className={printContent ? "report-no-print" : undefined}>
        <ReportOfficialHeader
          reportTitle={title}
          description={description}
          filterSummary={filterSummary}
          qrUrl={qrUrl}
          {...headerMeta}
        />
      </div>

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
            disabled={!!printContent && (!!isLoading || !hasRows)}
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

      {leading}

      {showSummaryBlocks && summary}

      <div className={printContent ? "report-no-print min-w-0" : "report-print-body min-w-0"}>
        {body}
      </div>
      {printContent && <div className="hidden print:block print-center-body">{printContent}</div>}
    </div>
  );
}
