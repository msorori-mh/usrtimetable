/**
 * Student / Instructor portal foundation — SOURCE ONLY.
 * Mission: STUDENT-INSTRUCTOR-PORTAL-SOURCE-FOUNDATION-01
 *
 * Current app_role enum: super_admin | college_admin | read_only ONLY.
 * No student/instructor portal roles exist. Do not invent production roles
 * without an approved migration. These stubs are admin-visible placeholders
 * for future read-only self-service pages (day/week/session/PDF).
 */

export const PORTAL_FOUNDATION_ROLES_TODAY = ["super_admin", "college_admin", "read_only"] as const;

export const PORTAL_FUTURE_ROLES_NOT_IN_ENUM = ["student", "instructor"] as const;

export const PORTAL_RBAC_NOTES_AR = {
  title: "بوابة الطالب والمدرس — أساس مصدري فقط",
  body: "الأدوار التشغيلية الحالية للإدارة فقط. لا توجد أدوار student/instructor في قاعدة الإنتاج. هذه الصفحات قراءة فقط وتصميم أساس؛ لن تُنشأ حسابات إنتاجية ولن تُطبَّق Migration أدوار في هذه الحزمة.",
  noEmailMatching: "يُمنع الاعتماد على مطابقة البريد غير الموثوقة لربط المدرس/الطالب بالحساب.",
  collegeIsolation: "أي بيانات مستقبلية يجب أن تبقى ضمن نطاق الكلية عبر RLS المعتمد.",
  noAdminControls: "واجهة البوابة المستقبلية بلا أدوات إدارة.",
} as const;

export const PORTAL_PLANNED_PAGES = [
  { id: "today", title_ar: "جدول اليوم", path: "/portal/student#today" },
  { id: "week", title_ar: "جدول الأسبوع", path: "/portal/student#week" },
  { id: "session", title_ar: "تفاصيل الجلسة", path: "/portal/student#session" },
  { id: "changes", title_ar: "التغييرات الحديثة", path: "/portal/student#changes" },
  { id: "pdf", title_ar: "تنزيل PDF", path: "/portal/student#pdf" },
] as const;

export function assertNoPortalRoleMigrationInSource(sqlOrEmpty: string): boolean {
  return !/ADD\s+VALUE\s+['"]?(student|instructor)['"]?/i.test(sqlOrEmpty);
}
