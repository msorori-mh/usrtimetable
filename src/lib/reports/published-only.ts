/**
 * PUBLISHED-ONLY-REPORTS-01 — schedule sources for the reports-only viewer.
 *
 * A `read_only`-ONLY account («مشاهد», e.g. the academic-affairs viewer) may read
 * timetable data ONLY from a PUBLISHED schedule version. Any draft / review /
 * approved version must be invisible, unselectable and never used as a fallback.
 * Accounts that also hold `super_admin`, `college_admin` or `institutional_viewer`
 * are unaffected — see {@link isReportsOnlyRole}.
 *
 * Everything here is pure so both the report context and the legacy report pages
 * share exactly one definition of "which versions may this account see".
 */
import type { SVStatus } from "@/lib/schedule-versions/lifecycle";
import { PUBLISHED_STATUSES, SPECIFIC_VERSION_STATUSES } from "@/lib/reports/filters";
import type { ReportStatusMode } from "@/lib/reports/types";

/** Shown instead of any data when the college/term has no published version yet. */
export const NO_PUBLISHED_VERSION_MESSAGE_AR =
  "لا توجد نسخة جدول منشورة لهذا الفصل/الكلية بعد.";

/** Context chip replacing the version-scope selector for the reports-only viewer. */
export const PUBLISHED_ONLY_CONTEXT_LABEL_AR = "منشور فقط";

export const PUBLISHED_ONLY_CONTEXT_HINT_AR =
  "هذا الحساب يقرأ الجداول من النسخ المنشورة فقط؛ لا تُعرض المسودات ولا نسخ المراجعة أو الاعتماد.";

/** The only status mode a reports-only account may ever use. */
export const PUBLISHED_ONLY_STATUS_MODE: ReportStatusMode = "published_only";

/** Forces `published_only` for the reports-only viewer, whatever the page requested. */
export function resolveReportStatusMode(
  requested: ReportStatusMode,
  publishedOnly: boolean,
): ReportStatusMode {
  return publishedOnly ? PUBLISHED_ONLY_STATUS_MODE : requested;
}

/** Version statuses this account may list/select. */
export function visibleVersionStatuses(publishedOnly: boolean): SVStatus[] {
  return publishedOnly ? [...PUBLISHED_STATUSES] : [...SPECIFIC_VERSION_STATUSES];
}

/** Drops every non-published version for the reports-only viewer. */
export function filterVisibleVersions<T extends { status: string }>(
  versions: readonly T[],
  publishedOnly: boolean,
): T[] {
  if (!publishedOnly) return [...versions];
  return versions.filter((v) => v.status === "published");
}

/**
 * Validates a stored / shared / QR-restored version id against the visible list.
 * A draft id is rejected (never silently kept) and the latest visible version is
 * used instead; with no visible version the selection stays empty — no fallback.
 */
export function sanitizeVersionSelection<T extends { id: string; status: string }>(
  versionId: string | null,
  versions: readonly T[],
  publishedOnly: boolean,
): string | null {
  const visible = filterVisibleVersions(versions, publishedOnly);
  if (versionId && visible.some((v) => v.id === versionId)) return versionId;
  return visible[0]?.id ?? null;
}
