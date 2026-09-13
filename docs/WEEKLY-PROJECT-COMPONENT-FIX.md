# إصلاح دائم: محاضرة «المشروع» الأسبوعي العادي مقابل مشروع التخرج

## القاعدة العامة

المعيار الفاصل هو `plan_course_components.counts_toward_regular_load`:

- `true` → مشروع أسبوعي عادي: يُجدول مثل الحصص الصفية، سعة من نوع القاعة، يُحسب حملًا تدريسيًا منتظمًا.
- `false` → إشراف مشروع تخرج: غير أسبوعي، يحتاج `explicit_group_size`، مستبعد من الحمل ومن الجدولة (`PROJECT_NON_WEEKLY`).

## قاعدة البيانات (migration مطبّقة)

`supabase/sql/weekly_project_component_fix.sql`

- `_import_sync_plan_course_components`: ساعات المشروع العادي (`is_graduation_project=false`) تصبح
  `counts_toward_regular_load/overtime=true`, `compensation_mode='per_hour'`, `is_timetabled=true`،
  وتدخل في حساب `lecture_hours` → `lectures_per_week`.
- `generate_cohort_delivery_groups`: لا يطلب `explicit_group_size` للمشروع الأسبوعي، يستخدم
  `required_room_type/default_capacity`، ولا يضع `excluded_from_standard_workload`. كما لم يعد يعيد
  تحذير `OBSOLETE_GROUP_*` لمجموعة كانت obsolete قبل التشغيل (تُحصى وتُحذّر عند الانتقال فقط).
- `_sb_v2_assignment_guard`, `ensure_ss_college`, `list_schedule_builder_v2_work_items`,
  `preview_instructor_workload_after_assignment`, `v_instructor_delivery_workload`: الحظر/الاستبعاد
  صار مشروطًا بـ`counts_toward_regular_load = false` فقط.
- الدوال الكبيرة عُدّلت نصيًا من تعريفها الحالي مع تأكيد نجاح كل استبدال، فبقيت بقية أسطرها كما هي.

## البيانات (backfill مطبّق)

- `courses`: USR07 و CS111 → `credit_hours=4, theory_hours=2, practical_hours=0`.
- `plan_courses` (10 صفوف): `lectures_per_week=2, labs_per_week=0, lecture_session_duration=2,
  lab_session_duration=2, required_room_type_for_lecture='lecture_hall', required_room_type_for_lab=NULL`.
- `plan_course_components`: تحويل `tutorial`/`practical` إلى `project` في المكان نفسه (نفس المعرّفات
  والروابط)، ثم توحيد `theory(2h)` + `project(2h)` في `lecture_hall` مع `regular=true`. لا `practical`
  ولا `tutorial` لهذين المقررين.
- `teaching_assignments`: نظري → `lecture` / `lecture_hall` / 2 ساعة، مشروع → `seminar` /
  `lecture_hall` / 2 ساعة، و`plan_course_component_id` مطابق للمجموعة. لا يوجد `lab`/`computer_lab`.
- تكليف المجموعة الزائدة G3 لمهارات الحاسوب في CYB-L1-2026 (`86a4944b…`) صار غير نشط دون حذف.

## الكود

- `src/lib/academic-delivery/delivery-groups.ts`: `countsTowardRegularLoad` جديد؛ المشروع الأسبوعي
  يتبع مسار سعة القاعة.
- `src/lib/academic-delivery/workload.ts` و`teaching-assignments-v2.ts`: الاستبعاد من الحمل يعتمد على
  `counts_toward_regular_load` لا على تسمية «project».
- `src/lib/auto-scheduler/session-plan.ts`: عندما يتقاسم أكثر من محاضرة نمط المحاضرات نفسه
  (نظري 2 + مشروع 2 من نمط 2×2)، تأخذ كل محاضرة جلساته من نفس المدة المعتمدة في الخطة بدل الحظر.

## التحقق

- استعلامات قاعدة البيانات: كل `plan_course` للمقررين = `theory 2 + project 2` في `lecture_hall`،
  0 محاضرة عملية/تمارين، 0 تكليف بغير `lecture_hall`، والدوال المعدّلة كلها تحمل الشرط الجديد.
- `tests/weekly-project-component.test.ts` (6 حالات)، `bun test` 372 pass (26 فشل بيئي سابق يحتاج
  PostgreSQL محلي)، `bun run test:harness` 72/72، `bunx tsgo --noEmit`، `bun run build` نجحت.
