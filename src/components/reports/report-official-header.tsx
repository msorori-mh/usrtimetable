import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PrintQrCode } from "@/components/print-center/print-qr-code";
import { USR_UNIVERSITY_LOGO_SRC } from "@/lib/branding/usr";
import {
  REPORT_COLLEGE_NAME_FALLBACK_AR,
  REPORT_UNIVERSITY_NAME_AR,
} from "@/lib/reports/branding";
import { STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import { STATUS_LABEL_AR, type SVStatus } from "@/lib/schedule-versions/lifecycle";
import type { ReportStudySystem } from "@/lib/reports/types";

export interface ReportOfficialHeaderMeta {
  termName?: string | null;
  versionName?: string | null;
  versionStatus?: SVStatus | null;
  studySystem?: ReportStudySystem;
  collegeName?: string | null;
  note?: string;
  /** Official published report — shows badge. */
  official?: boolean;
  /** Standard read-only operational/analytics report. */
  readOnly?: boolean;
}

interface Props extends ReportOfficialHeaderMeta {
  reportTitle: string;
  /** Screen-only duplicate of filter summary (optional). */
  filterSummary?: string;
  generatedAt?: Date;
  /** Real verification/report URL encoded in the header QR (never decorative). */
  qrUrl?: string | null;
}

function formatGeneratedAt(d: Date): string {
  return d.toLocaleString("ar", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function ReportOfficialHeader({
  reportTitle,
  termName,
  versionName,
  versionStatus,
  studySystem,
  collegeName,
  note,
  official,
  readOnly = true,
  filterSummary,
  generatedAt = new Date(),
  qrUrl,
}: Props) {
  const studyLabel = studySystem ? STUDY_SYSTEM_LABELS[studySystem] : undefined;
  const statusLabel = versionStatus ? STATUS_LABEL_AR[versionStatus] : undefined;

  const defaultNote = useMemo(() => {
    if (note) return note;
    if (official) return "تقرير رسمي — نسخة منشورة · للقراءة فقط.";
    if (readOnly) return "تقرير للقراءة فقط — لا يُشغّل محركات الجدولة أو الفحص.";
    return undefined;
  }, [note, official, readOnly]);

  return (
    <Card className="report-official-header border-primary/20 bg-card p-4 border-t-[3px] border-t-[var(--usr-gold)] print:shadow-none print:border print:break-inside-avoid">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-3 mb-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-primary">{REPORT_UNIVERSITY_NAME_AR}</p>
          <p className="text-base font-bold">{collegeName || REPORT_COLLEGE_NAME_FALLBACK_AR}</p>
        </div>
        <div className="text-left text-xs text-muted-foreground print:text-foreground">
          <p>تاريخ التوليد</p>
          <p className="font-medium">{formatGeneratedAt(generatedAt)}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-lg font-bold">{reportTitle}</h2>
        {official && (
          <Badge variant="default" className="print:border print:border-foreground">
            رسمي / منشور
          </Badge>
        )}
        {readOnly && !official && (
          <Badge variant="outline" className="print:border-foreground">
            قراءة فقط
          </Badge>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm">
        {termName && (
          <div>
            <dt className="text-muted-foreground text-xs">الفصل الدراسي</dt>
            <dd className="font-medium">{termName}</dd>
          </div>
        )}
        {versionName && (
          <div>
            <dt className="text-muted-foreground text-xs">نسخة الجدول</dt>
            <dd className="font-medium">{versionName}</dd>
          </div>
        )}
        {statusLabel && (
          <div>
            <dt className="text-muted-foreground text-xs">حالة النسخة</dt>
            <dd className="font-medium">{statusLabel}</dd>
          </div>
        )}
        {studyLabel && (
          <div>
            <dt className="text-muted-foreground text-xs">النظام الدراسي</dt>
            <dd className="font-medium">{studyLabel}</dd>
          </div>
        )}
      </dl>

      {defaultNote && (
        <p className="mt-3 text-xs text-muted-foreground border-t border-border/40 pt-2 print:text-foreground">
          {defaultNote}
        </p>
      )}

      {filterSummary && (
        <p className="mt-2 text-xs text-muted-foreground report-no-print">{filterSummary}</p>
      )}
    </Card>
  );
}

/** Build header meta from ReportContext fields. */
export function headerMetaFromContext(ctx: {
  selectedTerm?: { name: string } | null;
  selectedVersion?: { name: string; status: SVStatus } | null;
  studySystem: ReportStudySystem;
}): ReportOfficialHeaderMeta {
  return {
    termName: ctx.selectedTerm?.name,
    versionName: ctx.selectedVersion?.name,
    versionStatus: ctx.selectedVersion?.status,
    studySystem: ctx.studySystem,
  };
}
