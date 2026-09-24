/**
 * Schedule Builder foundation helpers (UX/access only — does not change RLS or roles).
 */

export const SCHEDULE_BUILDER_NAV_LABEL_AR = "بناء الجدول";
export const SCHEDULE_BUILDER_NAV_TO = "/schedule-builder" as const;

export const SCHEDULE_BUILDER_COLLEGE_MISMATCH_AR =
  "نسخة الجدول لا تنتمي إلى الكلية النشطة. اختر الكلية الصحيحة من المبدّل أو افتح نسخة من نسخ هذه الكلية.";

export const SCHEDULE_BUILDER_NO_COLLEGE_AR = "اختر كلية نشطة لعرض محرر الجدول.";

export const SCHEDULE_BUILDER_WORKSPACE_NO_COLLEGE_AR =
  "اختر كلية نشطة لعرض مساحة بناء الجدول.";

export const SCHEDULE_BUILDER_WORKSPACE_NO_TERM_AR =
  "لا توجد فصول دراسية لهذه الكلية. أضف فصلًا دراسيًا أولًا.";

export const SCHEDULE_BUILDER_WORKSPACE_NO_VERSIONS_AR =
  "لا توجد نسخ جدول للفصل المختار.";

export const SCHEDULE_BUILDER_WORKSPACE_NO_SESSIONS_AR =
  "النسخة المختارة لا تحتوي على جلسات مجدولة.";

export const SCHEDULE_BUILDER_WORKSPACE_FILTER_EMPTY_AR =
  "لا توجد جلسات تطابق المرشحات الحالية.";

/** Terms / versions / sessions load only after an active college is set. */
export function shouldLoadWorkspaceCollegeScoped(hasActiveCollege: boolean): boolean {
  return !!hasActiveCollege;
}

/** Version list requires college + selected term. */
export function shouldLoadWorkspaceVersions(opts: {
  hasActiveCollege: boolean;
  termId: string | null | undefined;
}): boolean {
  return !!opts.hasActiveCollege && !!opts.termId;
}

/** Session grid requires college + term + version. */
export function shouldLoadWorkspaceSessions(opts: {
  hasActiveCollege: boolean;
  termId: string | null | undefined;
  versionId: string | null | undefined;
}): boolean {
  return !!opts.hasActiveCollege && !!opts.termId && !!opts.versionId;
}

export const SCHEDULE_BUILDER_DEFAULT_START_HOUR = 8;
export const SCHEDULE_BUILDER_DEFAULT_END_HOUR = 14;

export type ScheduleVersionStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "archived"
  | string;

/** True when the schedule version belongs to the currently active college. */
export function isScheduleVersionInActiveCollege(
  version: { college_id: string } | null | undefined,
  activeCollegeId: string | null | undefined,
): boolean {
  if (!version?.college_id || !activeCollegeId) return false;
  return version.college_id === activeCollegeId;
}

/**
 * Sessions / lookups must stay disabled until college match succeeds.
 * Version must be loaded so a mismatch is distinguishable from loading.
 */
export function shouldLoadScheduleBuilderData(opts: {
  hasActiveCollege: boolean;
  versionLoaded: boolean;
  collegeMatches: boolean;
}): boolean {
  return opts.hasActiveCollege && opts.versionLoaded && opts.collegeMatches;
}

/** Published / archived versions are view-only regardless of role. */
export function isScheduleVersionWriteLocked(status: ScheduleVersionStatus | null | undefined): boolean {
  return status === "published" || status === "archived";
}

/**
 * Session dialog is read-only when the user cannot manage the college,
 * or the version is published/archived. Draft (and review/approved) stay editable
 * for authorized managers.
 */
export function isSessionDialogReadOnly(opts: {
  canManageRole: boolean;
  versionStatus: ScheduleVersionStatus | null | undefined;
}): boolean {
  if (!opts.canManageRole) return true;
  if (isScheduleVersionWriteLocked(opts.versionStatus)) return true;
  return false;
}

function parseHour(time: string | null | undefined, fallback: number): number {
  if (!time) return fallback;
  const h = parseInt(String(time).slice(0, 2), 10);
  return Number.isFinite(h) ? h : fallback;
}

/**
 * Resolve grid hour bounds: settings first, else template extents, else 08:00–14:00.
 * Never falls back to 20:00.
 */
export function resolveTimetableGridHours(opts: {
  settings?: { day_start_time?: string | null; day_end_time?: string | null } | null;
  templates?: Array<{ start_time: string; end_time: string }> | null;
}): { startHour: number; endHour: number } {
  const settings = opts.settings;
  if (settings?.day_start_time != null && settings?.day_end_time != null) {
    return {
      startHour: parseHour(String(settings.day_start_time), SCHEDULE_BUILDER_DEFAULT_START_HOUR),
      endHour: parseHour(String(settings.day_end_time), SCHEDULE_BUILDER_DEFAULT_END_HOUR),
    };
  }

  const templates = opts.templates ?? [];
  if (templates.length > 0) {
    let minStart = 24 * 60;
    let maxEnd = 0;
    for (const t of templates) {
      const [sh, sm] = String(t.start_time).slice(0, 5).split(":").map(Number);
      const [eh, em] = String(t.end_time).slice(0, 5).split(":").map(Number);
      const s = sh * 60 + (sm || 0);
      const e = eh * 60 + (em || 0);
      if (s < minStart) minStart = s;
      if (e > maxEnd) maxEnd = e;
    }
    return {
      startHour: Math.floor(minStart / 60),
      endHour: Math.ceil(maxEnd / 60),
    };
  }

  return {
    startHour: SCHEDULE_BUILDER_DEFAULT_START_HOUR,
    endHour: SCHEDULE_BUILDER_DEFAULT_END_HOUR,
  };
}
