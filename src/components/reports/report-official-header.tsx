import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PrintQrCode } from "@/components/print-center/print-qr-code";
import { USR_UNIVERSITY_LOGO_SRC } from "@/lib/branding/usr";
import { REPORT_COLLEGE_NAME_FALLBACK_AR, REPORT_UNIVERSITY_NAME_AR } from "@/lib/reports/branding";
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
  /** Short screen description shown under the title. */
  description?: string;
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

/**
 * One compact official header for screen and paper.
 *
 * Screen: a single dense identity band — university/college, report title,
 * context chips (term · version · status · system) and the read-only note.
 * Print: the same DOM, re-laid out by the `print-header-*` rules in styles.css
 * so the sheet keeps the logo, the real verification QR and the full metadata.
 */
export function ReportOfficialHeader({
  reportTitle,
  description,
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

  const context: { label: string; value: string }[] = [
    ...(termName ? [{ label: "الفصل الدراسي", value: termName }] : []),
    ...(versionName ? [{ label: "نسخة الجدول", value: versionName }] : []),
    ...(statusLabel ? [{ label: "حالة النسخة", value: statusLabel }] : []),
    ...(studyLabel ? [{ label: "النظام الدراسي", value: studyLabel }] : []),
  ];

  return (
    <Card className="report-official-header print-center-header border-primary/20 border-t-[3px] border-t-[var(--usr-gold)] bg-card p-3 sm:p-4 print:border print:shadow-none print:break-inside-avoid">
      <div className="print-header-identity-band grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border/60 pb-3">
        <div className="print-header-institution flex min-w-0 items-center gap-2">
          <img
            src={USR_UNIVERSITY_LOGO_SRC}
            alt={REPORT_UNIVERSITY_NAME_AR}
            className="print-header-logo h-10 w-10 shrink-0 object-contain sm:h-12 sm:w-12"
          />
          <div className="print-header-institution-copy min-w-0 hidden sm:block">
            <p className="print-header-university truncate text-xs font-semibold text-primary">
              {REPORT_UNIVERSITY_NAME_AR}
            </p>
            <p className="print-header-college break-words text-xs text-muted-foreground print:text-foreground">
              {collegeName || REPORT_COLLEGE_NAME_FALLBACK_AR}
            </p>
          </div>
        </div>

        <div className="print-header-title-block min-w-0">
          <p className="print-header-kicker text-[11px] text-muted-foreground print:text-foreground">
            {official ? "تقرير رسمي منشور" : "تقرير أكاديمي"}
          </p>
          <h1 className="min-w-0 break-words text-lg font-bold leading-tight sm:text-xl">
            <span className="print-header-report-title">{reportTitle}</span>
          </h1>
          <p className="text-[11px] text-muted-foreground print:text-foreground">
            تاريخ التوليد: {formatGeneratedAt(generatedAt)}
          </p>
        </div>

        {qrUrl ? (
          <div className="print-header-verification hidden shrink-0 flex-col items-center gap-1 text-[10px] text-muted-foreground print:flex sm:flex">
            <PrintQrCode value={qrUrl} size={56} title="رابط التقرير" />
            <span>رابط التقرير</span>
          </div>
        ) : (
          <span aria-hidden />
        )}
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
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
        <dl className="print-header-details flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
          {context.map((item) => (
            <div key={item.label} className="print-header-field flex min-w-0 items-baseline gap-1">
              <dt className="text-muted-foreground print:text-foreground">{item.label}:</dt>
              <dd className="min-w-0 break-words font-medium">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {description && (
        <p className="print-header-description mt-2 text-xs text-muted-foreground print:text-foreground">
          {description}
        </p>
      )}

      {defaultNote && (
        <p className="print-header-meta mt-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground print:text-foreground">
          {defaultNote}
        </p>
      )}

      {filterSummary && (
        <p className="report-no-print mt-1 text-[11px] text-muted-foreground">{filterSummary}</p>
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
