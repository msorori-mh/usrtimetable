import { ReactNode } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_MODE_LABELS, STUDY_SYSTEM_LABELS } from "@/lib/reports/filters";
import type { ReportContext, ReportFilterVisibility, ReportStatusMode, ReportStudySystem } from "@/lib/reports/types";
import { STATUS_LABEL_AR } from "@/lib/schedule-versions/lifecycle";

export interface ReportFiltersProps extends ReportFilterVisibility {
  context: ReportContext;
  children?: ReactNode;
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

export function ReportFilters({
  context,
  term = true,
  version = true,
  statusMode = true,
  studySystem = true,
  children,
}: ReportFiltersProps) {
  const {
    terms,
    termId,
    versions,
    versionId,
    statusMode: mode,
    studySystem: system,
    setTermId,
    setVersionId,
    setStatusMode,
    setStudySystem,
  } = context;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
      {term && (
        <FilterField label="الفصل الدراسي">
          <Select
            value={termId ?? ""}
            onValueChange={(v) => setTermId(v || null)}
            disabled={!terms.length}
          >
            <SelectTrigger>
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
        </FilterField>
      )}

      {statusMode && (
        <FilterField label="نطاق النسخ">
          <Select
            value={mode}
            onValueChange={(v) => setStatusMode(v as ReportStatusMode)}
          >
            <SelectTrigger>
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
        </FilterField>
      )}

      {version && (
        <FilterField label="نسخة الجدول">
          <Select
            value={versionId ?? ""}
            onValueChange={(v) => setVersionId(v || null)}
            disabled={!versions.length}
          >
            <SelectTrigger>
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
        </FilterField>
      )}

      {studySystem && (
        <FilterField label="نظام الدراسة">
          <Select
            value={system}
            onValueChange={(v) => setStudySystem(v as ReportStudySystem)}
          >
            <SelectTrigger>
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
        </FilterField>
      )}

      {children}
    </div>
  );
}
