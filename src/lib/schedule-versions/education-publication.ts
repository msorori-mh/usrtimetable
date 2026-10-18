/**
 * Sealed education source publication (source timetable + identity-only correction).
 * The versions are data — public.scheduling_policy_exceptions rows with
 * rule_code = 'education_source_publication' — loaded by
 * ./education-publication-loader.ts; no production id lives in the bundle (M-11).
 * Pure module.
 */
export interface EducationSourcePublication {
  version_id: string;
  college_id: string;
  term_id: string | null;
  role?: string | null;
}

let publications: EducationSourcePublication[] = [];

/** Version ids of the sealed publication (filled in place by setEducationSourcePublications). */
export const EDUCATION_SOURCE_PUBLICATION_VERSION_IDS: string[] = [];

export function setEducationSourcePublications(rows: readonly EducationSourcePublication[]): void {
  publications = rows.filter((row) => !!row.version_id);
  EDUCATION_SOURCE_PUBLICATION_VERSION_IDS.splice(
    0,
    EDUCATION_SOURCE_PUBLICATION_VERSION_IDS.length,
    ...publications.map((row) => row.version_id),
  );
}

export function getEducationSourcePublications(): readonly EducationSourcePublication[] {
  return publications;
}

/** The sealed source version (role 'source') of a college and term, if any. */
export function educationSourceVersionFor(
  collegeId: string | null | undefined,
  termId: string | null | undefined,
): EducationSourcePublication | null {
  if (!collegeId || !termId) return null;
  return (
    publications.find(
      (row) => row.college_id === collegeId && row.term_id === termId && row.role === "source",
    ) ?? null
  );
}

export const EDUCATION_SOURCE_PUBLICATION_NOTICE_AR =
  "اعتُمد جدول كلية التربية والعلوم لهذا الفصل وفق ملفات الأقسام، مع تصحيحات هوية المحاضرين المعتمدة ودون تغيير المواعيد أو الساعات، باستثناء أكاديمي مقيد بالترم والنسخة المنشورة. قد تكون بعض الأسماء مختصرة أو مؤقتة كما وردت في المصدر. يُحسب اكتمال الجدول من ساعاته وجلساته المنشورة مباشرة، ويظل التكليف الوظيفي المسجل مؤشرًا منفصلًا لا تنشئ هذه الموافقة له اعتمادًا ماليًا. 722 ساعة جلسات فعلية مقابل 724 ساعة في حصر الأقسام؛ الفرق ساعتان لمحاضرة مشتركة تُحسب مرة واحدة. تبقى صفوف المصدر غير المرتبطة ظاهرة في تقرير المطابقة.";

export function isEducationSourcePublication(versionId: string, termId?: string | null) {
  return publications.some(
    (row) => row.version_id === versionId && (termId === undefined || termId === row.term_id),
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
