# SOURCE_ONLY_PLAN_COURSE_COMPONENTS_UI_E2E_FIX_01

Baseline: `61864ceb7f5786530cf2de6fd7814b667b2c5f0e` (verified before any write).
Scope: SOURCE ONLY — no SQL, no migrations, no schema/RLS/RPC/auth change, no production data write, no publish.

## المشكلة المغلقة

E2E الإنتاجي أظهر أن `/study-plans` لا يوفر أي واجهة لإدارة `plan_courses` أو
`plan_course_components`، فبقي حاجز الجاهزية «مقررات غير مرتبطة بأي خطة دراسية»
مع `plan_courses=0`. الآن يستطيع مدير الكلية إدارة مقررات كل خطة ومكوّناتها من
الواجهة نفسها بالجداول والسياسات الحالية فقط.

## الملفات

| الملف | التغيير |
| --- | --- |
| `src/lib/academic-delivery/plan-course-editor.ts` | جديد — تحقق نقي وبناء الحمولات: scoping الكلية/البرنامج/الخطة، الفصل 1/2، منع التكرار، حقول المكوّنات، توليد من ساعات المقرر عبر `derivePlanCourseComponents`، ترتيب الحذف، تحقق المستوى، مفاتيح إبطال الجاهزية. |
| `src/components/study-plans/plan-courses-manager.tsx` | جديد — لوحة `Sheet` بعنوان «إدارة مقررات الخطة»: عرض المقررات (المقرر/المستوى/الفصل/إلزامي/المكوّنات)، CRUD لـ `plan_courses` و`plan_course_components`، زر «توليد من ساعات المقرر»، إضافة مستوى سريعة عند غياب `academic_levels`. |
| `src/routes/_authenticated/study-plans.tsx` | تركيب اللوحة لكل خطة + تحميل `duration_years` للبرنامج + صف متوافق مع الجوال. |
| `src/lib/data-onboarding/classify.ts` | رابط «أصلح الآن» للحاجز أصبح «أصلح الآن — إدارة مقررات الخطة» نحو `/study-plans`. |
| `tests/harness/plan-course-components-ui-e2e-fix.harness.ts` | جديد — 12 مجموعة تأكيدات. |
| `tests/harness/run.mjs` | تسجيل الـ harness الجديد. |

## القرارات

- الكلية والخطة والبرنامج تأتي من السياق فقط؛ لا حقول قابلة للتلاعب في النماذج.
- كل استعلام وكل كتابة مقيّدة بـ `college_id`، والتحقق يفشل مغلقاً عند أي عدم تطابق.
- التوليد يعتمد `theory_hours` و`practical_hours` فقط؛ `credit_hours` غير مستخدم
  (مقرر 2/2 يولّد `theory` و`practical` فقط).
- الحذف: مكوّنات المقرر بمعرّفات محددة أولاً ثم صف `plan_courses`، بعد تأكيد صريح.
  لم يُغيَّر حذف `study_plans` العام.
- أزرار الكتابة تظهر فقط عبر `useCanManageActiveCollege` الحالي؛ `read_only`
  و`institutional_viewer` عرض فقط. لا تغيير RBAC/RLS/auth.
- بعد كل كتابة تُبطل مفاتيح `plan-courses`, `plan-course-components`,
  `data-readiness`, `data-onboarding-readiness`, `dashboard-core-readiness`
  فيختفي الحاجز دون تحديث يدوي.
- إضافة المستوى تتحقق من 1..مدة البرنامج ومن عدم التكرار، ولا تولّد مستويات خفية.

## البوابات

| البوابة | النتيجة |
| --- | --- |
| prettier (الملفات المعدلة فقط) | PASS |
| `bunx tsgo --noEmit` | PASS |
| eslint مركز على الملفات المعدلة | PASS (0 مشاكل) |
| `bun test` | PASS — 66/66 |
| harness suite | PASS — 67 passed, 0 failed |
| build | PASS (`build OK`) |

## ثبات DB / RBAC

- migrations: لا
- SQL/schema/RLS/RPC/policies: لا
- auth/roles: لا
- كتابة بيانات إنتاجية أو تعديل بيانات TEST_ONLY: لا
- publish/deploy: لا

## الحالة

PASS.
