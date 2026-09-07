# INSTITUTIONAL_VIEWER_RBAC_PRECHECK_01 — تحليل فقط (لا تنفيذ)

الهدف: دور مؤسسي جديد `institutional_viewer` يرى كل الصفحات وكل الكليات والإعدادات والتقارير والمستخدمين، ويُمنع منعًا صارمًا من أي كتابة أو RPC تغييري أو استيراد أو تنظيف أو جدولة تلقائية أو نشر/اعتماد. سلوك `super_admin` / `college_admin` / `read_only` يبقى كما هو حرفيًا.

الحالة: تحليل جاهز، والتوصية النهائية **GO مشروط** بقرارين (انظر «المخاطر»).

---

## 1) مواضع الأدوار في الكود (ما يجب لمسه لاحقًا)

| الموضع | الحالة اليوم | التغيير المطلوب |
|---|---|---|
| `src/hooks/use-current-user.ts` | `AppRole = super_admin \| college_admin \| read_only`، أعلام `isSuperAdmin/isCollegeAdmin/isReadOnly` | إضافة `institutional_viewer` + علم `isInstitutionalViewer` + مشتق `canWriteAnything = false` له |
| `src/hooks/use-can-manage.ts` | `useCanManageActiveCollege` = super_admin أو college_admin في كليته | لا تغيير منطقي (الدور الجديد يرجع false تلقائيًا) — أهم ضمانة أن كل أزرار/نماذج التعديل تختفي |
| `src/components/app-layout.tsx` | نوع محلي `Role` مكرر + `ALL` + تصفية العناصر بـ `roles.includes(r)` + `roleLabel` | إضافة الدور إلى `Role` و`ALL`، وإضافته لعناصر super_admin-only (`/universities`, `/colleges`, `/users`) وعناصر `/import`, `/data-cleanup`, `/schedule-builder` وغيرها بحيث تُرى كلها، + تسمية «مشاهد مؤسسي» |
| `src/lib/unauthorized-access.ts` | `resolveSuperAdminPageAccess(me.isSuperAdmin)` | توسيع إلى `resolveAdminReadablePageAccess(me)` يسمح بالعرض للمشاهد المؤسسي مع علم `readOnly` منفصل يستخدمه الصفحة لإخفاء الكتابة |
| `src/routes/_authenticated/universities.tsx:65`، `colleges.tsx:76` | تحويل/`redirect` لغير super_admin | استبدال المنع بعرض قراءة فقط للدور الجديد |
| `src/routes/_authenticated/users.tsx` | `resolveSuperAdminPageAccess` + `ROLE_LABELS/ROLE_COLORS/ROLE_HINTS` + حوارات إنشاء/تعديل | عرض القوائم للقراءة، تعطيل «إنشاء مستخدم»/«مدير كلية»/تغيير الأدوار/إعادة كلمة المرور، وإضافة الدور الجديد إلى الخرائط الثلاث |
| ~40 صفحة تستخدم `canManage` (courses, rooms, terms, sections, instructors, delivery-groups, teaching-assignments, scheduling-*, constraint-settings, time-slot*, conflict-checks, data-onboarding, data-cleanup, auto-schedule, schedule-versions, schedule-quality, schedule-builder, timetable.$versionId …) | تخفي أزرار التعديل عندما `canManage=false` | لا تغيير — تُستخدم كما هي، لكن يلزم تدقيق أن كل زر/نموذج فعلاً مشروط بـ `canManage` (لا زر مكشوف) |
| `src/lib/**` نداءات RPC | `generate_cohort_curriculum`, `generate_cohort_delivery_groups`, `commit_import_job_atomic`, `create_import_preview_manifest`, `claim/finalize/fail_import_job`, `move_or_reschedule_schedule_session`, `approve_capacity_split_proposal`, `transition_schedule_version`, `persist_schedule_quality_run`, `create/update/deactivate_teaching_assignment_v2` | جميعها تغييرية: تبقى محمية بـ `can_manage_college` داخل الدالة (خط الدفاع الحقيقي) + إخفاء أزرارها في الواجهة |

القاعدة الملزمة: إخفاء عنصر القائمة أو الزر ليس تصريحًا. كل منع نهائي يجب أن يكون RLS أو فحص داخل RPC.

---

## 2) قاعدة البيانات: ما يُعدّل وما لا يُعدّل

الوضع الحالي (تم التحقق قراءةً):
- `app_role` = `super_admin, college_admin, read_only`.
- `can_view_college = is_super_admin OR user_in_college`؛ `can_manage_college = is_super_admin OR (college_admin AND user_in_college)`.
- **54** سياسة SELECT تستخدم `can_view_college`، و3 سياسات SELECT بـ `true`، و5 بـ `is_super_admin`.
- كل سياسات الكتابة (غير SELECT) تستخدم `can_manage_college` أو `is_super_admin` — **باستثناء واحد**: `audit_logs.al_insert WITH CHECK (actor_id = auth.uid())` أي أي مستخدم مسجَّل يستطيع إضافة سجل تدقيق.

التعديلات المطلوبة (الحد الأدنى):
1. **`can_view_college`**: تصبح `is_super_admin OR user_in_college OR is_institutional_viewer` → يفتح 54 سياسة SELECT لكل الكليات بتغيير واحد، دون لمس أي سياسة.
2. **`can_manage_college`**: **بلا أي توسعة** (مطلب صريح) → كل الكتابة و22 RPC تغييري يُرفض تلقائيًا للدور الجديد.
3. دالة مساعدة جديدة `is_institutional_viewer(uuid)` — SQL, STABLE, SECURITY DEFINER, `SET search_path = public, pg_temp`, `REVOKE EXECUTE FROM PUBLIC, anon`.
4. سياسات SELECT الإدارية الخمس تحتاج إضافة الدور صراحة: `colleges.col_select`, `profiles.prof_select`, `user_roles.ur_select`, `user_colleges.uc_select`, `audit_logs.al_select` (universities SELECT = true أصلًا).
5. **RPCs قراءة فقط لكنها مقيَّدة بـ `can_manage_college`** ويجب أن ترى بيانات وإلا ستتعطل صفحات كاملة للدور الجديد: `list_teaching_assignment_workspace`, `get_delivery_group_assignment_candidates`, `list_schedule_builder_v2_work_items`, `compute_instructor_standard_workload`, `validate_schedule_session_move`, `resolve_scheduling_headcount`, `list_scheduling_headcount_revisions`. الحل: تعديل شرطها الداخلي إلى `can_manage_college(...) OR is_institutional_viewer(auth.uid())` — دالة بدالة، دون توسيع `can_manage_college`. (`validate_*` تبقى بلا أي كتابة؛ إن كانت تكتب أي شيء تُستثنى.)
6. **`handle_new_user`**: لا تغيير (الافتراضي `read_only` يبقى) — الدور الجديد يُمنح يدويًا من صفحة المستخدمين بحساب super_admin.
7. **`audit_logs.al_insert`**: قرار مطلوب — إما تركه (إضافة سجل تدقيق باسم النفس، غير مؤذٍ) أو تضييقه بـ `AND NOT is_institutional_viewer(auth.uid())` لتحقيق «صفر كتابة» حرفيًا. التوصية: تضييقه لأن المطلب «منع صارم لكل INSERT».
8. لا حاجة لأي `GRANT` جديد: الجداول ممنوحة أصلًا لـ `authenticated`، والحاكم هو RLS.

---

## 3) خطة المهاجرات (آمنة، ومراعية لحدود المعاملة)

`ALTER TYPE ... ADD VALUE` لا يمكن استخدام القيمة الجديدة في نفس المعاملة، لذلك يُقسَّم العمل إلى مهاجرتين منفصلتين تُطبَّقان بالترتيب:

**M1 — إضافة القيمة فقط** (لا شيء آخر في الملف)
```
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'institutional_viewer';
```

**M2 — الدوال والسياسات** (تُطبَّق بعد نجاح M1)
- `CREATE OR REPLACE FUNCTION public.is_institutional_viewer(uuid)` + `REVOKE`.
- `CREATE OR REPLACE FUNCTION public.can_view_college(...)` بالنسخة الموسّعة.
- `can_manage_college` بدون تغيير (يوثَّق صراحة في تعليق الملف).
- إعادة إنشاء سياسات SELECT الخمس الإدارية (DROP/CREATE بنفس الأسماء).
- تعديل الشرط الداخلي لـ 7 دوال القراءة المذكورة (نسخة كاملة `CREATE OR REPLACE`، مع الحفاظ على التوقيع و`search_path` و`REVOKE`).
- (اختياري بحسب القرار) تضييق `al_insert`.

**M3 — اختياري**: قيود «حزام أمان» عبر ترايجر عام يرفع `INSTITUTIONAL_VIEWER_READ_ONLY` عند أي كتابة من مستخدم بهذا الدور على الجداول الحساسة. يوصى بها كطبقة ثانية فقط، لا كبديل عن RLS.

قواعد التطبيق: لا تعديل مصدر قبل نجاح M1+M2؛ تُعاد توليد `src/integrations/supabase/types.ts` بعد M1 (سيظهر الدور في enum المولّد)؛ ثم تُعدَّل الواجهة.

الترتيب النهائي: M1 → إعادة توليد الأنواع → M2 → تعديلات الواجهة (البند 1) → الاختبارات (البند 5) → نشر.

---

## 4) صفحات super_admin-only والنسخة القرائية

| الصفحة | اليوم | للدور الجديد |
|---|---|---|
| `/universities` | حجب كامل لغير super_admin | جدول الجامعة للقراءة؛ إخفاء إضافة/تعديل/حذف |
| `/colleges` | `redirect('/dashboard')` | قائمة كل الكليات للقراءة؛ إخفاء إنشاء/تعديل/حذف وربط المستخدمين |
| `/users` | `resolveSuperAdminPageAccess` | قائمة المستخدمين وأدوارهم وكلياتهم للقراءة؛ تعطيل إنشاء مستخدم/مدير كلية، تغيير دور، ربط كلية، إعادة كلمة مرور |
| `/my-college` | `college_admin, read_only` فقط | تُترك كما هي أو تُظهر الكلية النشطة للقراءة (الأفضل: إظهارها لأن الدور يرى كل الكليات عبر منتقي الكلية) |
| `/import`, `/data-cleanup`, `/auto-schedule`, `/schedule-builder`, `/schedule-versions`, `/schedule-quality`, `/scheduling-headcounts` | مرئية لمن يملك الإدارة | مرئية للقراءة: تظهر البيانات والنتائج، وتُخفى أزرار الاستيراد/التنظيف/التوليد/النقل/الاعتماد/النشر |

نمط التنفيذ الموحّد: `access = allowed | forbidden | loading` تُفصل عن `readOnly: boolean`؛ الصفحة تعرض شارة «قراءة فقط» في الأعلى وتلف كل أزرار الكتابة بشرط `!readOnly`.

منتقي الكلية: `useAccessibleColleges` يعتمد على RLS فقط، فمع تعديل `can_view_college` سيرى الدور الجديد كل الكليات دون أي تعديل في الكود.

---

## 5) خطة الاختبارات

إيجابية (رؤية):
- تسجيل دخول بحساب اختباري بالدور الجديد ثم زيارة كل مسار في `src/routes/_authenticated/**` (≈60 مسارًا) وإثبات HTTP 200 ولا رسالة «ليس لديك صلاحية» ولا خطأ Console.
- منتقي الكلية يظهر كل الكليات (8) وليس المُسندة فقط.
- SELECT مباشر عبر PostgREST بجلسة الدور الجديد على جداول من كل مجموعة (courses, rooms, schedule_sessions, audit_logs, profiles, user_roles, user_colleges, colleges) → تعداد يساوي تعداد super_admin.
- صفحات التقارير الـ14 تُنتج بيانات (لا صفر مصطنع) وتصدير CSV/Excel يعمل.

سلبية (منع):
- كل RPC تغييري (`transition_schedule_version`, `approve_capacity_split_proposal`, `move_or_reschedule_schedule_session`, `generate_cohort_curriculum`, `generate_cohort_delivery_groups`, `commit_import_job_atomic`, `create_import_preview_manifest`, `claim/finalize/fail_import_job`, `create/update/deactivate_teaching_assignment_v2`, `upsert/approve_scheduling_cohort_term_headcount`, `upsert/archive_scheduling_headcount_override`, `persist_schedule_quality_run`, `begin_schedule_quality_snapshot`, `commit_teaching_assignments_v2_import`) → خطأ صريح، وصفر تغيير في التعدادات.
- INSERT/UPDATE/DELETE مباشر عبر PostgREST على 10 جداول تمثيلية + `colleges`/`user_roles`/`user_colleges`/`universities` → 403/0 صفوف.
- `audit_logs` INSERT → مرفوض (إن اعتُمد التضييق).
- عدم الانحدار: إعادة تشغيل حزمة الاختبارات الحالية (`bun test`, harness) وإثبات أن `super_admin`/`college_admin`/`read_only` بلا أي تغيير سلوكي، وأن `can_manage_college` نصها لم يتغير (اختبار ثابت على نص الدالة).
- خط الأساس بعد كل الاختبارات: colleges=8, teaching_assignments=263, schedule_sessions=109, schedule_versions=3 بلا تغيير.

---

## 6) مخاطر / موانع محتملة

1. **قرار مطلوب — `audit_logs.al_insert`**: السياسة الوحيدة التي تسمح بكتابة لأي مستخدم مسجَّل. بدون تضييقها لا يتحقق «منع صارم لكل INSERT».
2. **قرار مطلوب — الـ7 دوال القراءة المقيَّدة بـ `can_manage_college`**: بدون تعديلها ستظهر صفحات (بناء الجدول، أعباء المدرسين، أعداد الطلاب، مساحة عمل التكليفات) فارغة أو بخطأ للدور الجديد. تعديلها لا يوسّع `can_manage_college` لكنه يوسّع قراءة تلك الدوال — يلزم إقرارك.
3. `can_view_college` مستخدمة في 54 سياسة: تعديلها تغيير واسع الأثر بطبيعته؛ الأثر مقصور على SELECT لكن يجب تشغيل linter + مسح أمني بعده.
4. حساسية البيانات: الدور يرى `profiles` (بريد كل المستخدمين) و`audit_logs` لكل الكليات — تأكيد مؤسسي مطلوب.
5. `ALTER TYPE ADD VALUE` لا يمكن استخدامه في نفس المعاملة → إن دُمجت M1+M2 في ملف واحد ستفشل؛ الفصل إلزامي.
6. المهاجرات الموصوفة كـ source-only غير مطبَّقة (headcount, legacy hardening) قد تعيد كتابة دوال نعدّلها؛ يجب تضمين توسعة الدور الجديد فيها عند تطبيقها لاحقًا وإلا حدث انحدار صامت.
7. لا يوجد اليوم اختبار آلي يثبت أن كل زر كتابة مشروط بـ `canManage`؛ زر واحد غير مشروط = نداء يفشل بخطأ قبيح (وليس ثغرة). يوصى باختبار ثابت (harness) يفحص ذلك.
8. مسار `auto-schedule` على الخادم غير مُتحقَّق مستقلًا (GAP-8 في مصفوفة التصريح) — يلزم تتبّعه قبل الإعلان عن منع «الجدولة التلقائية».

**التوصية**: GO بعد إقرار البندين 1 و2، وبالترتيب M1 → أنواع → M2 → واجهة → اختبارات.
