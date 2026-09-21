import type {
  PrintCenterFilters,
  PrintReportType,
} from "./types";

export interface PrintQrParams {
  versionId: string;
  reportType: PrintReportType;
  programId?: string | null;
  levelId?: string | null;
  studySystem?: string | null;
  departmentId?: string | null;
  instructorId?: string | null;
  roomId?: string | null;
  cohortId?: string | null;
  deliveryGroupId?: string | null;
}

/** Serialize print-center filters into URL search params (stable key order). */
export function printFiltersToSearchParams(params: PrintQrParams): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set("type", params.reportType);
  if (params.programId) sp.set("program", params.programId);
  if (params.levelId) sp.set("level", params.levelId);
  if (params.studySystem) sp.set("study", params.studySystem);
  if (params.departmentId) sp.set("dept", params.departmentId);
  if (params.instructorId) sp.set("instructor", params.instructorId);
  if (params.roomId) sp.set("room", params.roomId);
  if (params.cohortId) sp.set("cohort", params.cohortId);
  if (params.deliveryGroupId) sp.set("dg", params.deliveryGroupId);
  return sp;
}

/**
 * Build absolute (or path) QR URL for the current print view.
 * Always includes versionId in the path and filter params in the query.
 */
export function buildPrintQrUrl(originOrBase: string, params: PrintQrParams): string {
  const path = `/timetable/${encodeURIComponent(params.versionId)}/print`;
  const qs = printFiltersToSearchParams(params).toString();
  const base = originOrBase.replace(/\/$/, "");
  return qs ? `${base}${path}?${qs}` : `${base}${path}`;
}

export function filtersToQrParams(
  versionId: string,
  filters: PrintCenterFilters,
): PrintQrParams {
  return {
    versionId,
    reportType: filters.reportType,
    programId: filters.programId,
    levelId: filters.levelId,
    studySystem: filters.studySystem,
    departmentId: filters.departmentId,
    instructorId: filters.instructorId,
    roomId: filters.roomId,
    cohortId: filters.cohortId,
    deliveryGroupId: filters.deliveryGroupId,
  };
}

export function parsePrintSearchParams(search: URLSearchParams): Partial<PrintCenterFilters> {
  const type = search.get("type") as PrintReportType | null;
  return {
    reportType:
      type && ["student", "department", "program", "instructor", "room", "level"].includes(type)
        ? type
        : undefined,
    programId: search.get("program"),
    levelId: search.get("level"),
    studySystem: (search.get("study") as PrintCenterFilters["studySystem"]) ?? undefined,
    departmentId: search.get("dept"),
    instructorId: search.get("instructor"),
    roomId: search.get("room"),
    cohortId: search.get("cohort"),
    deliveryGroupId: search.get("dg"),
  };
}
