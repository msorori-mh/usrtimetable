# PLAN-COURSE-COMPONENT-ROOM-TYPE-NORMALIZATION-SOURCE-01

## النتيجة

نفذت المرحلة كمصدر واختبارات فقط، دون SQL أو Migration أو كتابة بيانات أو Deploy. بقي
مسار الحفظ في حالة fail-closed لأن `commit_import_job_atomic` الحالي لا يقرأ
`_plan_component_sync` ولا يكتب `plan_course_components.required_room_type_id`.

القرار: `HOLD_PLAN_COMPONENT_ROOM_TYPE_NORMALIZATION_SOURCE_ATOMIC_PERSISTENCE_RPC_REQUIRED`

## السبب الجذري

قالبا الخطة كانا يحتويان حقلي lecture/lab النصيين القديمين فقط. التحقق لم يكن يحل
رموز أنواع القاعات إلى سجل واحد تابع لكلية الخطة، ومزامنة المكوّنات داخل RPC التاريخي
تنشئ/تحدّث المكوّنات دون `required_room_type_id`. لذلك كان مولد مجموعات التدريس يصل إلى
مرجع فارغ ثم يصنف النتيجة بصورة عامة كـ`MISSING_CAPACITY`.

## الملفات

- `src/lib/excel-import/templates.ts`, `types.ts`, `validators.ts`,
  `room-type-normalize.ts`, `commit.ts`
- `src/lib/data-templates/catalog.ts`
- `src/lib/academic-delivery/plan-component-room-types.ts`,
  `cohort-room-type-gate.ts`, `generate-delivery-groups.ts`,
  `plan-course-components.ts`
- `src/lib/reports/readiness.ts`
- `src/routes/_authenticated/academic-cohorts.tsx`
- `src/routes/_authenticated/reports.data-readiness.tsx`
- `tests/harness/plan-component-room-type-normalization-source.harness.ts`

## القوالب والـaliases

الأعمدة القانونية المصدرة:

- `required_room_type_code_lecture` — `نوع_قاعة_المحاضرة_رمز`
- `required_room_type_code_practical` — `نوع_قاعة_العملي_رمز`
- `required_room_type_code_tutorial` — `نوع_قاعة_التمرين_رمز`
- `required_room_type_code_project` — `نوع_قاعة_المشروع_رمز`

أبقيت العمودين القديمين، وقبلت كذلك الاسمين الإنجليزيين:
`required_room_type_for_lecture` و`required_room_type_for_lab`. التعارض بين القانوني
والـalias يفشل بـ`ROOM_TYPE_ALIAS_CONFLICT`.

## التحقق وعقد الحفظ

التطبيع يستخدم `resolveAliasToCanonical` بعد trim/case/space normalization. يحل الرمز
مرة واحدة ضمن كلية الخطة، ويجمع أخطاء جميع المكوّنات ذات الساعات الموجبة القابلة
للجدولة. الرموز:

`ROOM_TYPE_CODE_REQUIRED`, `ROOM_TYPE_CODE_UNKNOWN`,
`ROOM_TYPE_CODE_AMBIGUOUS`, `ROOM_TYPE_INACTIVE`,
`ROOM_TYPE_ZERO_CAPACITY`, `ROOM_TYPE_WRONG_COLLEGE`,
`ROOM_TYPE_ALIAS_CONFLICT`.

تفاصيل الخطأ تشمل صف Excel والبرنامج والمقرر واسمه والمستوى والفصل والمكوّن والساعات
والحقل والقيمة الخام والسبب. عند نجاح الصف يبنى عقد `_plan_component_sync` وفيه
`required_room_type_id`.

لا يستهلك RPC الحالي هذا العقد. منع العميل commit للكيانين
`study_plan_courses` و`full_study_plan` برسالة
`PLAN_COMPONENT_ROOM_TYPE_PERSISTENCE_RPC_REQUIRED`، قبل RPC، كي لا يحدث نجاح جزئي أو
مضلل. لا توجد كتابة عميل بديلة.

## الجاهزية

أضيف blocker قانوني `PLAN_COMPONENT_ROOM_TYPE_MISSING` للخطط النشطة فقط. يفحص null
والمرجع اليتيم وغير النشط والسعة غير الموجبة والكلية الخاطئة. تظهر القائمة كاملة في
تقرير جاهزية البيانات، مع الكلية والبرنامج والخطة والمستوى والفصل والمقرر والمكوّن
والساعات ومعرف/رمز نوع القاعة ورمز المشكلة ورسالتها.

## بوابة التوليد

يفحص wrapper مكوّنات عروض الدفعة قبل `resolve_scheduling_headcount` وقبل
`generate_cohort_delivery_groups`. يجمع القائمة كاملة ويرمي
`MISSING_ROOM_TYPE_COMPONENTS`. الزر الفعلي `توليد مجموعات المحاضرات والمعامل` معطل عند وجود
blocker وتظهر القائمة والإجراء المطلوب. زر `توليد مقررات الدفعة` مستقل ولم يرتبط
بالبوابة.

غياب نوع القاعة لا يصل إلى المولد كي يتحول إلى `MISSING_CAPACITY`; تبقى الأخيرة
لنوع موجود ذي سعة غير صالحة في التنفيذ التاريخي.

## التدريب الصيفي

`summer_training` مشتق كمكوّن `is_timetabled=false`، ويستبعد من توليد منهج الدفعة
عندما يكون صيفيًا فقط، لذلك لا يخمن له نوع قاعة. إذا ظهر مكوّن تدريب صيفي مجدول
بساعات موجبة تفشل البوابة بـ`SUMMER_TRAINING_ROOM_POLICY_REQUIRED`.

## الاختبارات وعدم مس البيانات

يغطي harness الجديد الأعمدة والـaliases والتعارض، الحالات السبعة السلبية، الساعات
الصفرية، التدريب الصيفي، بناء payload، وجميع عيوب الجاهزية، وحاجز commit وترتيب بوابة
DG والزر الفعلي. لا يحتوي التغيير Migration أو SQL تنفيذي أو backfill أو DML إنتاجي.

النتائج المحلية:

- `bunx tsc --noEmit`: PASS.
- harness المرحلة: PASS.
- `import-templates-final-audit`: PASS.
- `academic-delivery-v2-import-generator`: PASS.
- عقد DG الجديد داخل harness المرحلة: PASS.
- `reports-read-model-a1-5`: PASS.
- lint للملفات المعدلة: PASS.
- `bun run build`: PASS.
- `git diff --check`: PASS.
- `bun run test:harness`: 38 PASS، وفشلان تاريخيان خارج المرحلة
  (`course-offering-dependency-fk` يتوقع UI غير موجود في `origin/main`،
  و`delivery-groups-workload-engine` يتوقع المصطلح القديم المحظور
  `مجموعات التدريس` بدل المصطلح الحالي)، وملفان تاريخيان مفقودان من `origin/main`
  (`experimental-schedule-reset-room-integrity` و`teaching-assignments-v2-runtime`).
- lint الشامل: `HOLD_BASELINE_CRLF`؛ آلاف مخالفات CRLF في ملفات غير معدلة. لم تنفذ
  إعادة تنسيق شاملة خارج النطاق.

## المرحلة E المؤجلة

بعد اتخاذ قرار موثق بشأن 68 قيمة null و26 حالة ambiguous:

1. إنشاء RPC/تعديل RPC في مرحلة Migration مستقلة وبموافقة صريحة، ليحل ويحفظ
   `required_room_type_id` داخل نفس معاملة الاستيراد.
2. تشغيل verifier بعد التطبيق يثبت عدم وجود عيوب في أي خطة نشطة.
3. إزالة حاجز العميل فقط بعد إثبات نسخة RPC وقدرتها.
4. بعد remediation موثق، إضافة constraint قاعدة البيانات المناسب (وليس قبله).
5. عدم auto-map للحالات الغامضة؛ كل mapping يحتاج قرارًا صريحًا.

## الافتراضات والمخاطر والعوائق وأثر الإنتاج

- الافتراض: الـRPC المنشور يعكس المصدر التاريخي الموجود؛ لا توجد دالة أخرى موثقة
  تحفظ المعرّف ذرّيًا.
- الخطر المتبقي: استيراد الخطط محجوب عمدًا حتى توفير RPC صحيح.
- العائق: لا يمكن تحقيق الحفظ الذري المطلوب ضمن منع Migration/SQL.
- أثر الإنتاج: صفر؛ source-only، ولا SQL ولا كتابة بيانات ولا Deploy ولا flags.
