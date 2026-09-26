/** Exact 2026–2027 first-term source timetable; no other version inherits this exception. */
export const EDUCATION_SOURCE_PUBLICATION_VERSION_ID = "7430bad7-2de7-5c90-9368-b214a199d6c3";
export const EDUCATION_SOURCE_PUBLICATION_TERM_ID = "93705393-609d-4605-ae94-9572cd8b2090";

export const EDUCATION_SOURCE_PUBLICATION_NOTICE_AR =
  "نُشر جدول هذا الفصل باستثناء أسماء وإسنادات مؤقتة مأخوذة من ملفات الأقسام. 46 مجموعة دون تكليف إداري معتمد، و722 ساعة جلسات فعلية مقابل 726 ساعة في حصر الأقسام. تبقى صفوف المصدر غير المرتبطة ظاهرة في تقرير المطابقة؛ يلزم التحقق من الأسماء والتكليف، ولا ينشئ هذا النشر اعتماداً مالياً.";

export function isEducationSourcePublication(versionId: string, termId?: string | null) {
  return (
    versionId === EDUCATION_SOURCE_PUBLICATION_VERSION_ID &&
    (termId === undefined || termId === EDUCATION_SOURCE_PUBLICATION_TERM_ID)
  );
}
