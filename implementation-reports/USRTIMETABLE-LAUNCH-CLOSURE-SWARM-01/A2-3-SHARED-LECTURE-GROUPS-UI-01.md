# A2.3 — واجهة المجموعات المشتركة للمحاضرات (Shared Lecture Groups UI)

- السرب: USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01 — الموجة WAVE-05
- المهمة: A2.3 (مكدّسة على A2.1 + A2.2)
- الفرع: `feat/a2-3-shared-lecture-groups-ui` (من رأس `feat/a2-2-shared-lecture-groups-authz`)
- النمط المتبع: أسلوب PR #62/PR #74 — واجهة فوق RPCs غير مطبقة: types محلية + `rpc(name as never)` + readiness blocker موثق داخل الصفحة. لم يُعدَّل `src/integrations/supabase/types.ts` يدويًا.

## مانع الجاهزية (READINESS BLOCKER — موثق داخل الصفحة أيضًا)

جداول وRPCs المجموعات المشتركة للمحاضرات **SOURCE ONLY — NOT APPLIED** بانتظار بوابة
`APPROVE_DB_MIGRATION_APPLY` (مع مقدماتها `20260717050000` و`20260721180000` و`20260722090000`
و`20260722120000`). لذلك كل قراءة/كتابة من هذه الواجهة ستفشل في بيئة الإنتاج حتى الاعتماد
والتطبيق، والصفحة تعرض ذلك صراحة كمانع جاهزية موثق، وتُظهر أخطاء النقل (transport) برسالة
«طبقة RPCs غير مطبقة بعد (NOT APPLIED)» بدل أي التباس.

## الملفات

| الملف | التغيير |
| --- | --- |
| `src/lib/shared-lecture-groups/types.ts` | أنواع محلية (مجموعة/روابط/عضويات/مراجعات/سعة/نتيجة RPC) — لا تعديل للأنواع المولّدة |
| `src/lib/shared-lecture-groups/api.ts` | مغلّفات RPC فقط لكل RPCs العشرة (A2.1: 6 + A2.2: transition/remove_component/cross-college×2) — بلا أي وصول جداول |
| `src/lib/shared-lecture-groups/rules.ts` | تسميات الحالة والمراجعات، حواف دورة الحالة المسموحة، ورسائل عربية لكل رموز fail-closed |
| `src/routes/_authenticated/shared-lecture-groups.tsx` | الصفحة: قائمة + إنشاء + تفاصيل (مكوّنات، دفعات، cross-college، حالة، سعة، مراجعات) |
| `src/routeTree.gen.ts` | تسجيل يدوي بأسلوب البيت للمسار `/_authenticated/shared-lecture-groups` |
| `src/components/app-layout.tsx` | مدخل NAV بالتسمية الرسمية «المجموعات المشتركة للمحاضرات» ضمن «البنية الأكاديمية» |
| `tests/harness/shared-lecture-groups-ui.harness.ts` | harness ساكن (انظر التحقق) |
| `tests/harness/run.mjs` | تسجيل الـ harness بعد `shared-lecture-groups-authz.harness.ts` |

## القرارات

1. **كل كتابة عبر RPC فقط — لا DML مباشر إطلاقًا.** `api.ts` لا يحتوي أي `.from(` إطلاقًا؛
   القراءات من جداول `shared_lecture_group*` تتم عبر واجهة SELECT ضيقة (`fromSourceOnly`)
   لأن الجداول غير موجودة في الأنواع المولّدة (SELECT مسموح بـ GRANT/RLS؛ INSERT/UPDATE/DELETE
   مقموعة أصلًا في A2.1/A2.2). أسماء RPC ووسائط `p_*` طُوبقت حرفيًا مع ملفي الترحيل.
2. **انتقالات الحالة** draft→active→locked→archived (والأرشفة من أي حالة) عبر
   `transition_shared_lecture_group_status` فقط، وأزرار الواجهة تعرض الحواف المسموحة نفسها؛
   أخطاء `SHARED_GROUP_NO_COMPONENTS/NO_COHORTS/HEADCOUNT_MISSING/GROUP_LOCKED/GROUP_ARCHIVED/
   INVALID_STATUS_TRANSITION` تُعرض برسائل عربية واضحة مع الرمز.
3. **السعة fail-closed**: `resolve_shared_lecture_group_capacity` وحدها تحسب (مجموع
   `scheduling_headcount` المعتمد لمساري العضوية)؛ الواجهة لا تجمع ولا تخمّن أي رقم، وغياب أي
   عدد معتمد يظهر كحالة `blocked` مع عدد الدفعات الناقصة.
4. **عزل الأدوار**: `useCanManageActiveCollege` يخفي كل أزرار الكتابة عن `read_only`
   (والإنفاذ الحقيقي في RPC/RLS)؛ قسم «دفعات عبر الكليات» لا يُعرض إلا لـ `super_admin`
   (`isSuperAdmin`) ويستدعي مساري `add/remove_cross_college_cohort_*` الحصريين.
5. **لا خلط منتظم/موازي**: رفض `STUDY_SYSTEM_MIX_REJECTED` يُعرض برسالة عربية صريحة،
   وتُعرض ملاحظة النظام الدراسي للمجموعة عند وجود أعضاء.
6. **منتقي المكوّنات** بدمج client-side ثلاثي الخطوات (plan_course_components → plan_courses
   → courses) بدون PostgREST embeds لتفادي الاعتماد على بيانات FK وصفية غير متحقق منها.
   الربط على مستوى `plan_course_components` (دمج النظري وبقاء المعامل منفصلة) موثق في الصفحة.
7. إزالة المكوّن تُعرض في حالة المسودة فقط، مع إبراز الحارسين fail-closed
   (`SHARED_GROUP_COMPONENT_IN_USE` في أي حالة، و`SHARED_GROUP_COMPONENT_UNLINK_BLOCKED`
   بعد مغادرة المسودة) — والإنفاذ النهائي في RPC.
8. لا Sections/`section_id`/`course_offerings` في New Flow؛ لا seed؛ لا أرقام مختلقة.

## التحقق

- harness ساكن جديد `shared-lecture-groups-ui.harness.ts` (مسجّل في `run.mjs`) يتحقق من:
  وجود الملفات، مطابقة أسماء RPC العشرة ووسائط `p_*` مع ترحيلَي A2.1/A2.2، غياب أي DML مباشر
  (`.insert/.update/.delete/.upsert`) وغياب `.from(` في طبقة API، غياب مراجع legacy
  (`section_id`/`course_offerings`/`section_number`)، وجود readiness blocker داخل الصفحة،
  المصطلحات الرسمية، تغطية رموز fail-closed برسائل عربية، عرض `STUDY_SYSTEM_MIX_REJECTED`
  (منتظم/موازي)، عدم حساب السعة في الواجهة (`.reduce(` ممنوع)، عزل الأدوار، حواف دورة الحالة،
  مدخل NAV بالتسمية الرسمية، تسجيل المسار في `routeTree.gen.ts`، وتسجيل الـ harness نفسه.

### نتيجة التشغيل (فعلية — ليست ساكنة بالمراجعة فقط)

شُغِّل الـ harness **فعليًا** محليًا عبر `npx tsx@4.20.6` على بايتات الفرع الفعلية: أُعيد
بناء شجرة جزئية محلية (13 ملفًا يقرؤها الـ harnesses الثلاثة) وتحُقِّق من أن كل ملف محلي
يطابق blob الفرع حرفيًا عبر `git hash-object` (مطابقة SHA تامة لكل الملفات الثلاثة عشر،
بما فيها الترحيلان والصفحة و`routeTree.gen.ts` و`app-layout.tsx` و`run.mjs`). النتائج:

- `shared-lecture-groups-ui.harness.ts` → **pass** (exit 0)
- `shared-lecture-groups-authz.harness.ts` → **pass** (exit 0) — تأكيد عدم كسر harness A2.2
- `shared-lecture-groups.harness.ts` → **pass** (exit 0) — تأكيد عدم كسر harness A2.1

ملاحظة صدق: التشغيل اقتصر على الـ harnesses الثلاثة المتعلقة بـ A2.x (بقية حزمة `run.mjs`
تتطلب شجرة المستودع الكاملة)؛ ولم يُشغَّل `tsc`/build للتطبيق (UNKNOWN أدناه).

## UNKNOWN / BLOCKER

- **BLOCKER (مانع جاهزية)**: الجداول وRPCs مصدرية فقط NOT APPLIED بانتظار
  `APPROVE_DB_MIGRATION_APPLY` — لا يمكن اختبار سلوكي حقيقي قبل التطبيق.
- **UNKNOWN**: نجاح `tsc`/البناء الكامل للواجهة في CI (لم يُتحقق منه محليًا ضد شجرة المشروع
  الكاملة؛ الـ harness ساكن ولا يبني التطبيق).
- **UNKNOWN**: توفر مرشح `academic_terms.name` وأعمدة `plan_course_components/plan_courses/courses`
  المستخدمة في المنتقيات كما هي في الأنواع المولّدة الحالية (افتراض قائم على مطابقة صفحات البيت
  مثل `delivery-groups.tsx`/`scheduling-headcounts.tsx`؛ سيثبت عند أول تشغيل فعلي بعد التطبيق).
- **UNKNOWN**: مدى تغطية RLS لقراءة `academic_cohorts` عبر الكليات لـ super_admin في منتقي
  cross-college (الإنفاذ النهائي RPC-side في كل الأحوال؛ المنتقي عنصر راحة فقط).
