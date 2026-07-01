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
  } = options;

  const effectiveDefaultMode = fixedStatusMode ?? defaultStatusMode;

  const { active, isLoading: collegeLoading } = useActiveCollege();
  const collegeId = active?.id ?? null;

  const [termId, setTermIdState] = useState<string | null>(null);
  const [versionId, setVersionIdState] = useState<string | null>(null);
  const [statusMode, setStatusModeState] = useState<ReportStatusMode>(effectiveDefaultMode);
  const [studySystem, setStudySystemState] = useState<ReportStudySystem>(defaultStudySystem);

  const {
    data: terms = [],
    isLoading: termsLoading,
    error: termsError,
  } = useQuery({
    queryKey: ["report-terms", collegeId],
    enabled: !!collegeId,
    queryFn: () => fetchAcademicTerms(collegeId!),
  });

  // Auto-select latest term when college or terms list changes.
  useEffect(() => {
    if (!terms.length) {
      setTermIdState(null);
      return;
    }
    if (!termId || !terms.some((t) => t.id === termId)) {
      setTermIdState(terms[0].id);
    }
  }, [terms, termId]);

  const {
    data: versions = [],
    isLoading: versionsLoading,
    error: versionsError,
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
    if (!versions.length) {
      setVersionIdState(null);
      return;
    }
    if (!versionId || !versions.some((v) => v.id === versionId)) {
      setVersionIdState(versions[0].id);
    }
  }, [versions, versionId]);

  const setTermId = useCallback((id: string | null) => {
    setTermIdState(id);
    setVersionIdState(null);
  }, []);

  const setVersionId = useCallback((id: string | null) => {
    setVersionIdState(id);
  }, []);

  const setStatusMode = useCallback((mode: ReportStatusMode) => {
    if (fixedStatusMode) return;
    setStatusModeState(mode);
    setVersionIdState(null);
  }, [fixedStatusMode]);

  const setStudySystem = useCallback((system: ReportStudySystem) => {
    setStudySystemState(system);
  }, []);

  const selectedVersion = useMemo(
    () => versions.find((v) => v.id === versionId) ?? null,
    [versions, versionId],
  );

  const selectedTerm = useMemo(
    () => terms.find((t) => t.id === termId) ?? null,
    [terms, termId],
  );

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
