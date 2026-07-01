import type { SVStatus } from "@/lib/schedule-versions/lifecycle";

/** Which schedule versions a report may use. */
export type ReportStatusMode = "published_only" | "working" | "specific_version";

/** Filter sessions by study system (regular / parallel / both). */
export type ReportStudySystem = "regular" | "parallel" | "all";

export interface AcademicTermOption {
  id: string;
  name: string;
}

export interface ScheduleVersionOption {
  id: string;
  name: string;
  status: SVStatus;
  academic_term_id: string;
}

/** User-controllable filter values shared across reports. */
export interface ReportFilters {
  termId: string | null;
  versionId: string | null;
  statusMode: ReportStatusMode;
  studySystem: ReportStudySystem;
}

/** Metadata describing a report for the hub / registry (future phases). */
export interface ReportDefinition {
  id: string;
  route: string;
  title: string;
  description: string;
  defaultStatusMode: ReportStatusMode;
  defaultStudySystem: ReportStudySystem;
  requiresVersion: boolean;
}

/** Resolved context consumed by report pages and query helpers. */
export interface ReportContext {
  collegeId: string | null;
  terms: AcademicTermOption[];
  termId: string | null;
  versions: ScheduleVersionOption[];
  versionId: string | null;
  selectedVersion: ScheduleVersionOption | null;
  statusMode: ReportStatusMode;
  studySystem: ReportStudySystem;
  isLoading: boolean;
  error: Error | null;
  filterSummary: string;
  setTermId: (id: string | null) => void;
  setVersionId: (id: string | null) => void;
  setStatusMode: (mode: ReportStatusMode) => void;
  setStudySystem: (system: ReportStudySystem) => void;
}

export interface UseReportContextOptions {
  defaultStatusMode?: ReportStatusMode;
  defaultStudySystem?: ReportStudySystem;
  /** Locks statusMode (e.g. published-only official reports). */
  fixedStatusMode?: ReportStatusMode;
}

/** Which unified filter controls a report page exposes. */
export interface ReportFilterVisibility {
  term?: boolean;
  version?: boolean;
  statusMode?: boolean;
  studySystem?: boolean;
}
