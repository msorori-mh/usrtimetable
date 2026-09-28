/** Exact source timetable and its sealed, identity-only correction. */
export const EDUCATION_SOURCE_PUBLICATION_VERSION_ID = "7430bad7-2de7-5c90-9368-b214a199d6c3";
export const EDUCATION_SOURCE_IDENTITY_REVISION_ID = "3fc16124-dbfa-4fc0-93c9-db1ea9a560dd";
export const EDUCATION_SOURCE_PUBLICATION_VERSION_IDS = [
  EDUCATION_SOURCE_PUBLICATION_VERSION_ID,
  EDUCATION_SOURCE_IDENTITY_REVISION_ID,
] as const;
export const EDUCATION_SOURCE_PUBLICATION_TERM_ID = "93705393-609d-4605-ae94-9572cd8b2090";

export const EDUCATION_SOURCE_PUBLICATION_NOTICE_AR =
  "اعتُمد جدول كلية التربية والعلوم لهذا الفصل وفق ملفات الأقسام، مع تصحيحات هوية المحاضرين المعتمدة ودون تغيير المواعيد أو الساعات، باستثناء أكاديمي مقيد بالترم والنسخة المنشورة. قد تكون بعض الأسماء مختصرة أو مؤقتة كما وردت في المصدر. يُحسب اكتمال الجدول من ساعاته وجلساته المنشورة مباشرة، ويظل التكليف الوظيفي المسجل مؤشرًا منفصلًا لا تنشئ هذه الموافقة له اعتمادًا ماليًا. 722 ساعة جلسات فعلية مقابل 724 ساعة في حصر الأقسام؛ الفرق ساعتان لمحاضرة مشتركة تُحسب مرة واحدة. تبقى صفوف المصدر غير المرتبطة ظاهرة في تقرير المطابقة.";

export function isEducationSourcePublication(versionId: string, termId?: string | null) {
  return (
    EDUCATION_SOURCE_PUBLICATION_VERSION_IDS.some((id) => id === versionId) &&
    (termId === undefined || termId === EDUCATION_SOURCE_PUBLICATION_TERM_ID)
  );
}

/** Academic approval of this exact published timetable, never an HR assignment. */
export function educationSourceTimetableApprovalPercent(
  college: {
    version_id: string | null;
    term_id: string | null;
    term_state: string;
    required_hours: number | null;
    teaching_hours: number | null;
    sessions_count: number | null;
  },
  namedPublishedPercent: number | null,
): number | null {
  const { version_id, term_id, term_state, required_hours, teaching_hours, sessions_count } =
    college;
  if (
    !version_id ||
    !isEducationSourcePublication(version_id, term_id) ||
    term_state !== "ready" ||
    required_hours === null ||
    teaching_hours === null ||
    !Number.isFinite(required_hours) ||
    !Number.isFinite(teaching_hours) ||
    required_hours <= 0 ||
    teaching_hours < 0 ||
    teaching_hours > required_hours ||
    !sessions_count ||
    namedPublishedPercent === null
  )
    return null;
  return Math.min(namedPublishedPercent, Math.round((teaching_hours / required_hours) * 1000) / 10);
}
