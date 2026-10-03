import { collegeSupportsParallel } from "@/lib/study-systems";
import { ReportScopeError } from "@/lib/reports/preferences";
import { readReportPreference, writeReportPreference } from "@/lib/reports/preferences";
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
    fixedStudySystem,
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
  const [studySystemState, setStudySystemState] = useState<ReportStudySystem>(
    initialFilters?.studySystem ?? defaultStudySystem,
  );

  const studySystem =
    fixedStudySystem ?? (collegeSupportsParallel(active) ? studySystemState : "regular");

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

  const [restoredCollege, setRestoredCollege] = useState<string | null>(null);
  useEffect(() => {
    if (!collegeId || restoredCollege === collegeId) return;
    const saved = readReportPreference(`context:${collegeId}`);
    const params = new URLSearchParams(window.location.search);
    if (!initialFilters) {
      setTermIdState(params.get("termId") || saved.termId || null);
      setVersionIdState(params.get("versionId") || saved.versionId || null);
      const mode = params.get("statusMode") || saved.statusMode;
      if (!fixedStatusMode && ["published_only", "working", "specific_version"].includes(mode))
        setStatusModeState(mode as ReportStatusMode);
      const system = params.get("studySystem") || saved.studySystem;
      if (["all", "regular", "parallel"].includes(system))
        setStudySystemState(system as ReportStudySystem);
    }
    setRestoredCollege(collegeId);
  }, [collegeId, restoredCollege, initialFilters, fixedStatusMode]);

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
    if (!termsReady || restoredCollege !== collegeId) return;
    if (!terms.length) {
      setTermIdState(null);
      return;
    }
    if (!termId || !terms.some((t) => t.id === termId)) {
      setTermIdState(terms[0].id);
    }
  }, [terms, termId, termsReady, restoredCollege, collegeId]);

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
    if (!versionsReady || restoredCollege !== collegeId) return;
    if (!versions.length) {
      setVersionIdState(null);
      return;
    }
    if (!versionId || !versions.some((v) => v.id === versionId)) {
      setVersionIdState(versions[0].id);
    }
  }, [versions, versionId, versionsReady, restoredCollege, collegeId]);

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
        { termId, versionId, statusMode: fixedStatusMode ?? statusMode, studySystem },
        {
          termName: selectedTerm?.name,
          versionName: selectedVersion?.name,
        },
      ),
    [termId, versionId, fixedStatusMode, statusMode, studySystem, selectedTerm, selectedVersion],
  );

  useEffect(() => {
    if (!collegeId || restoredCollege !== collegeId || !selectedTerm || !selectedVersion) return;
    writeReportPreference(`context:${collegeId}`, {
      termId: selectedTerm.id,
      versionId: selectedVersion.id,
      statusMode: fixedStatusMode ?? statusMode,
      studySystem,
    });
  }, [
    collegeId,
    restoredCollege,
    selectedTerm,
    selectedVersion,
    fixedStatusMode,
    statusMode,
    studySystem,
  ]);

  const linkCollege =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("collegeId");
  const error = (
    linkCollege && collegeId && linkCollege !== collegeId
      ? new ReportScopeError("هذا الرابط يخص كلية أخرى؛ اختر الكلية المقصودة من قائمة الكليات.")
      : (termsError ?? versionsError)
  ) as Error | null;
  const isLoading =
    collegeLoading ||
    termsLoading ||
    versionsLoading ||
    (!!collegeId && restoredCollege !== collegeId);

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
