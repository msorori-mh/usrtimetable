import { ReactNode, useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowRight, Download, FileSpreadsheet, Printer } from "lucide-react";
import { CollegeSwitcher } from "@/components/college-switcher";
import {
  ReportOfficialHeader,
  headerMetaFromContext,
  type ReportOfficialHeaderMeta,
} from "@/components/reports/report-official-header";
import { useActiveCollege } from "@/hooks/use-colleges";
import { downloadCSV, downloadXLSX, type Row } from "@/lib/reports/export";
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
  /** Always rendered above the loading/empty/body area (e.g. delivery-demo warning). */
  leading?: ReactNode;
  rows: Row[];
  headers: { key: string; label: string }[];
  filename: string;
  children?: ReactNode;
  isLoading?: boolean;
  emptyMessage?: string;
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
  leading,
  rows,
  headers,
  filename,
  children,
  isLoading,
  emptyMessage,
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

  return (
    <div className="report-print-root min-w-0 space-y-4" dir="rtl">
      <ReportOfficialHeader reportTitle={title} filterSummary={filterSummary} {...headerMeta} />

      <div className="report-no-print flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/reports">
                <ArrowRight className="h-4 w-4 ml-1" /> العودة
              </Link>
            </Button>
            <h1 className="min-w-0 break-words text-2xl font-bold">{title}</h1>
          </div>
          {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          <CollegeSwitcher />
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-4 w-4 ml-1" /> طباعة
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!rows.length}
            onClick={() => downloadCSV(rows, headers, filename)}
          >
            <Download className="h-4 w-4 ml-1" /> CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!rows.length}
            onClick={() => downloadXLSX(rows, headers, filename)}
          >
            <FileSpreadsheet className="h-4 w-4 ml-1" /> Excel
          </Button>
        </div>
      </div>

      {filters && <Card className="report-no-print min-w-0 overflow-hidden p-4">{filters}</Card>}

      {leading}

      <div className="report-print-body min-w-0">
        {isLoading ? (
          <Card className="p-8 text-center text-muted-foreground">جارٍ التحميل…</Card>
        ) : rows.length === 0 ? (
          <Card className="p-8 text-center text-muted-foreground">
            {emptyMessage ?? "لا توجد بيانات بهذه المعايير."}
          </Card>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
