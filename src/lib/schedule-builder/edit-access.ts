/**
 * Local edit-mode access gates for Schedule Builder (UI only — no mutations).
 */
import {
  isScheduleVersionWriteLocked,
  type ScheduleVersionStatus,
} from "@/lib/schedule-builder/access";

export const SCHEDULE_BUILDER_EDIT_MODE_LABEL_AR = "تفعيل وضع التعديل";
export const SCHEDULE_BUILDER_EXIT_EDIT_MODE_LABEL_AR = "إنهاء وضع التعديل";
export const SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR = "هذه النسخة غير قابلة للتعديل.";
export const SCHEDULE_BUILDER_LOCAL_ONLY_NOTICE_AR =
  "لم يتم بعد فحص التعارضات النهائية. هذا التغيير محلي وغير محفوظ.";
export const SCHEDULE_BUILDER_UNSAVED_BADGE_AR = "غير محفوظ";
export const SCHEDULE_BUILDER_NO_DB_SAVE_NOTICE_AR =
  "لن تُحفظ هذه التغييرات في قاعدة البيانات ضمن هذه المرحلة.";

/** Version statuses that may enter local edit mode (managers only). */
export function isScheduleVersionEditableStatus(
  status: ScheduleVersionStatus | null | undefined,
): boolean {
  if (!status) return false;
  if (isScheduleVersionWriteLocked(status)) return false;
  return status === "draft" || status === "review" || status === "approved";
}

export function canEnterEditMode(opts: {
  canManageRole: boolean;
  hasActiveCollege: boolean;
  versionId: string | null | undefined;
  versionStatus: ScheduleVersionStatus | null | undefined;
}): boolean {
  if (!opts.canManageRole) return false;
  if (!opts.hasActiveCollege) return false;
  if (!opts.versionId) return false;
  return isScheduleVersionEditableStatus(opts.versionStatus);
}

export function editModeBlockedReason(opts: {
  canManageRole: boolean;
  hasActiveCollege: boolean;
  versionId: string | null | undefined;
  versionStatus: ScheduleVersionStatus | null | undefined;
}): string | null {
  if (!opts.hasActiveCollege) return "اختر كلية نشطة أولًا.";
  if (!opts.canManageRole) return "عرض فقط — لا تملك صلاحية التعديل.";
  if (!opts.versionId) return "اختر نسخة جدول أولًا.";
  if (isScheduleVersionWriteLocked(opts.versionStatus)) {
    return SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR;
  }
  if (!isScheduleVersionEditableStatus(opts.versionStatus)) {
    return SCHEDULE_BUILDER_VERSION_NOT_EDITABLE_AR;
  }
  return null;
}

/** Locked sessions cannot be opened in the local edit sheet. */
export function canOpenSessionForLocalEdit(opts: {
  editModeActive: boolean;
  canEnterEdit: boolean;
  session: { is_locked?: boolean } | null | undefined;
}): boolean {
  if (!opts.editModeActive || !opts.canEnterEdit) return false;
  if (!opts.session) return false;
  if (opts.session.is_locked) return false;
  return true;
}
