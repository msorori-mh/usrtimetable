import { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportFilterBar, ReportFilterField } from "@/components/reports/report-filter-bar";
import { STATUS_MODE_LABELS, STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import type {
  ReportContext,
  ReportFilterVisibility,
  ReportStatusMode,
  ReportStudySystem,
} from "@/lib/reports/types";
import { STATUS_LABEL_AR } from "@/lib/schedule-versions/lifecycle";

export interface ReportFiltersProps extends ReportFilterVisibility {
  context: ReportContext;
  /** Report-specific essential filters (instructor, room, …). */
  children?: ReactNode;
  /** Report-specific secondary filters, collapsed with the advanced section. */
  advanced?: ReactNode;
  /** Free-text search over the visible rows. */
  search?: { value: string; onChange: (value: string) => void; placeholder?: string };
  /** Extra chips appended to the active-filter summary. */
  extraSummary?: string[];
  /** Report-specific reset; the shared context filters are reset as well. */
  onClear?: () => void;
}

export { ReportFilterField };

/**
 * Unified report filter area built on {@link ReportFilterBar}: term, version and
 * the page's main entity stay visible; version scope, study system and
 * report-specific extras live inside the collapsible advanced section.
 */
export function ReportFilters({
  context,
  term = true,
  version = true,
  statusMode = true,
  studySystem = true,
  children,
  advanced,
  search,
  extraSummary,
  onClear,
}: ReportFiltersProps) {
  const {
    terms,
    termId,
    versions,
    versionId,
    statusMode: mode,
    publishedOnly,
    studySystem: system,
    filterSummary,
    setTermId,
    setVersionId,
    setStatusMode,
    setStudySystem,
  } = context;

  /**
   * PUBLISHED-ONLY-REPORTS-01 — the reports-only viewer never gets the version-scope
   * selector (draft / review / approved); the locked scope is stated instead.
   */
  const showStatusMode = statusMode && !publishedOnly;

  const clear = () => {
    setStatusMode("specific_version");
    setStudySystem("all");
    onClear?.();
  };

  const basic = (
    <>
      {term && (
        <ReportFilterField label="الفصل الدراسي" htmlFor="report-filter-term">
          <Select
            value={termId ?? ""}
            onValueChange={(v) => setTermId(v || null)}
            disabled={!terms.length}
          >
            <SelectTrigger id="report-filter-term" aria-label="الفصل الدراسي">
              <SelectValue placeholder="اختر الفصل" />
            </SelectTrigger>
            <SelectContent>
              {terms.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ReportFilterField>
      )}

      {version && (
        <ReportFilterField label="نسخة الجدول" htmlFor="report-filter-version">
          <Select
            value={versionId ?? ""}
            onValueChange={(v) => setVersionId(v || null)}
            disabled={!versions.length}
          >
            <SelectTrigger id="report-filter-version" aria-label="نسخة الجدول">
              <SelectValue placeholder="اختر نسخة" />
            </SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name} — {STATUS_LABEL_AR[v.status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </ReportFilterField>
      )}

      {children}
    </>
  );

  const advancedContent =
    showStatusMode || publishedOnly || studySystem || advanced ? (
      <>
        {publishedOnly && (
          <ReportFilterField label="نطاق النسخ">
            <p
              className="text-sm text-muted-foreground"
              data-testid="report-filter-published-only-note"
            >
              {PUBLISHED_ONLY_CONTEXT_LABEL_AR} — {PUBLISHED_ONLY_CONTEXT_HINT_AR}
            </p>
          </ReportFilterField>
        )}

        {showStatusMode && (
          <ReportFilterField label="نطاق النسخ" htmlFor="report-filter-status-mode">
            <Select value={mode} onValueChange={(v) => setStatusMode(v as ReportStatusMode)}>
              <SelectTrigger id="report-filter-status-mode" aria-label="نطاق النسخ">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_MODE_LABELS) as ReportStatusMode[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STATUS_MODE_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ReportFilterField>
        )}

        {studySystem && (
          <ReportFilterField label="نظام الدراسة" htmlFor="report-filter-study-system">
            <Select value={system} onValueChange={(v) => setStudySystem(v as ReportStudySystem)}>
              <SelectTrigger id="report-filter-study-system" aria-label="نظام الدراسة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STUDY_SYSTEM_LABELS) as ReportStudySystem[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {STUDY_SYSTEM_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ReportFilterField>
        )}

        {advanced}
      </>
    ) : undefined;

  return (
    <ReportFilterBar
      basic={basic}
      advanced={advancedContent}
      search={search}
      activeSummary={[...filterSummary.split(" · ").filter(Boolean), ...(extraSummary ?? [])]}
      onClear={clear}
    />
  );
}
