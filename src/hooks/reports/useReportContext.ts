import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActiveCollege } from "@/hooks/use-colleges";
import { buildFilterSummary } from "@/lib/reports/filters";
import { fetchAcademicTerms, fetchScheduleVersions } from "@/lib/reports/queries/version-queries";
import type {
  ReportContext,
  ReportStatusMode,
  ReportStudySystem,
  UseReportContextOptions,
} from "@/lib/reports/types";

export function useReportContext(options: UseReportContextOptions = {}): ReportContext {
  const {
    defaultStatusMode = "specific_version",
    defaultStudySystem = "all",
    fixedStatusMode,
    initialFilters,
  } = options;

  const effectiveDefaultMode = fixedStatusMode ?? defaultStatusMode;

  const { active, isLoading: collegeLoading } = useActiveCollege();
  const collegeId = active?.id ?? null;

  const [termId, setTermIdState] = useState<string | null>(initialFilters?.termId ?? null);
  const [versionId, setVersionIdState] = useState<string | null>(initialFilters?.versionId ?? null);
  const [statusMode, setStatusModeState] = useState<ReportStatusMode>(
    initialFilters?.statusMode ?? effectiveDefaultMode,
  );
  const [studySystem, setStudySystemState] = useState<ReportStudySystem>(
    initialFilters?.studySystem ?? defaultStudySystem,
  );

  /**
   * REPORTS-COLLEGE-SWITCH-01 — switching the active college must not leave the
   * previous college's term/version selected while the new lists load.
   */
  const [lastCollegeId, setLastCollegeId] = useState<string | null>(collegeId);
  if (collegeId !== lastCollegeId) {
    setLastCollegeId(collegeId);
    setTermIdState(null);
    setVersionIdState(null);
  }

  const {
    data: terms = [],
    isLoading: termsLoading,
    error: termsError,
    isSuccess: termsReady,
  } = useQuery({
    queryKey: ["report-terms", collegeId],
    enabled: !!collegeId,
    queryFn: () => fetchAcademicTerms(collegeId!),
  });

  // Auto-select latest term when college or terms list changes.
  useEffect(() => {
    if (!termsReady) return;
    if (!terms.length) {
      setTermIdState(null);
      return;
    }
    if (!termId || !terms.some((t) => t.id === termId)) {
      setTermIdState(terms[0].id);
    }
  }, [terms, termId, termsReady]);

  const {
    data: versions = [],
    isLoading: versionsLoading,
    error: versionsError,
    isSuccess: versionsReady,
  } = useQuery({
    queryKey: ["report-versions", collegeId, termId, fixedStatusMode ?? statusMode],
    enabled: !!collegeId && !!termId,
    queryFn: () =>
      fetchScheduleVersions({
        collegeId: collegeId!,
        termId,
        statusMode: fixedStatusMode ?? statusMode,
      }),
  });

  // Reset version when term or status mode changes; keep selection if still valid.
  useEffect(() => {
    if (!versionsReady) return;
    if (!versions.length) {
      setVersionIdState(null);
      return;
    }
    if (!versionId || !versions.some((v) => v.id === versionId)) {
      setVersionIdState(versions[0].id);
    }
  }, [versions, versionId, versionsReady]);

  const setTermId = useCallback((id: string | null) => {
    setTermIdState(id);
    setVersionIdState(null);
  }, []);

  const setVersionId = useCallback((id: string | null) => {
    setVersionIdState(id);
  }, []);

  const setStatusMode = useCallback(
    (mode: ReportStatusMode) => {
      if (fixedStatusMode) return;
      setStatusModeState(mode);
      setVersionIdState(null);
    },
    [fixedStatusMode],
  );

  const setStudySystem = useCallback((system: ReportStudySystem) => {
    setStudySystemState(system);
  }, []);

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === versionId) ?? null,
    [versions, versionId],
  );

  const selectedTerm = useMemo(() => terms.find((t) => t.id === termId) ?? null, [terms, termId]);

  const filterSummary = useMemo(
    () =>
      buildFilterSummary(
        { termId, versionId, statusMode, studySystem },
        {
          termName: selectedTerm?.name,
          versionName: selectedVersion?.name,
        },
      ),
    [termId, versionId, statusMode, studySystem, selectedTerm, selectedVersion],
  );

  const error = (termsError ?? versionsError) as Error | null;
  const isLoading = collegeLoading || termsLoading || versionsLoading;

  return {
    collegeId,
    terms,
    termId,
    versions,
    versionId,
    selectedVersion,
    statusMode: fixedStatusMode ?? statusMode,
    studySystem,
    isLoading,
    error,
    filterSummary,
    setTermId,
    setVersionId,
    setStatusMode,
    setStudySystem,
  };
}
