## Reports visual system (current batch)

- [x] Shared primitives: report-kpis, report-filter-bar, report-states, report-section
- [x] ReportShell / ReportOfficialHeader / ReportTimetableView / ReportFilters
- [x] Routes: instructor-schedule, room-timetable, section-timetable, quality-summary, data-readiness, conflicts, unscheduled, instructor-workload
- [ ] Routes: room-utilization, department-schedule, published-timetable, program-level-timetable, academic-affairs, quality-analytics, reports index
- [ ] Contract tests tests/report-visual-system.test.ts
- [ ] Prettier + ESLint + typecheck + build + report/print tests + full harness; report PASS/HOLD

### دفعة النظام البصري للتقارير — مكتملة

- primitives: KPI/فلاتر/حالات/أقسام وجداول + shell وترويسة رسمية وطباعة.
- كل مسارات التقارير مدمجة: instructor-schedule, room-timetable, section-timetable, program-level-timetable, published-timetable, academic-affairs, quality-summary, quality-analytics, data-readiness, conflicts, unscheduled, instructor-workload, room-utilization, department-schedule, فهرس التقارير (بحث في البطاقات).
- اختبارات العقد: tests/report-visual-system.test.ts (14 حالة) + تحديث اختبارَي الاحتواء وبوابة الدور للمكوّنات المشتركة.
- الفحوص: typecheck و ESLint (تحذير fast-refresh واحد قديم) و build OK و git diff --check نظيف. مجموعة bun test: 523 نجاح و26 إخفاق قديم (NameTooLong/بيئة) مطابق للـbaseline.

### إخفاء شارة الكلية لحساب reports-only في `/reports`

- [x] تعديل `src/components/app-layout.tsx`: إخفاء `activeCollege.name` عند `reportsOnly === true` ومسار `/reports` أو `/reports/` مع الإبقاء على breadcrumb.
- [x] إضافة regression test يثبت أن reports-only لا يرى الشارة على `/reports` وباقي الحالات لا تتأثر.
- [x] تشغيل typecheck + ESLint + الاختبار المركّز + build + git diff --check.

## توحيد عرض أسماء الكيانات دون الأكواد

- [x] إضافة helper مركزي للاسم البشري مع fallback آمن عند غياب الاسم.
- [x] تطبيقه على المحددات والجداول والبطاقات والتقارير والطباعة.
- [x] إضافة regression tests للأكواد الجامعية والمقررات والمحاضرين والتقارير/الطباعة.
- [x] Prettier + scoped ESLint + typecheck + focused tests + build + diff check.
- [ ] نشر النسخة بعد مراجعة فحص الأمان.

## تطوير تقرير القاعات التحليلي

- [x] إضافة الحسابات التحليلية والملخص التنفيذي والفئات والذروة وكفاءة السعة دون تعديل البيانات.
- [x] فصل القاعات والمعامل وإضافة الفرز والفلاتر وأعلى/أقل خمسة والرسوم وخريطة الحرارة.
- [x] تحسين التفاصيل الأسبوعية وبنية طباعة A3 مع الرأس الرسمي وعدم إسقاط أي جلسة.
- [x] إضافة اختبارات الحسابات والتجميع وبنية الشاشة والطباعة، ثم تشغيل الفحوص والنشر.

## عرض سياق الإسناد التدريسي

- [x] إضافة البرنامج ونظام الدراسة من بيانات الدفعة إلى جدول الإسناد.
- [x] إظهار جميع البرامج والأنظمة المشاركة في مجموعات المحاضرات المشتركة.
- [x] تشغيل الاختبارات المركزة وTypeScript وESLint والبناء دون نشر.

## تصحيح مراجع وقالب جدول الشريعة

- [ ] إنشاء ترحيل ذري مغلق عند الخطأ لاستبدال 8 مراجع إسناد قديمة ببدائلها النشطة الوحيدة في نسختي الشريعة.
- [ ] إنشاء قالب فترات نشط للشريعة من الفترات المتطابقة 08:00–14:00 دون تغيير أوقات الجلسات.
- [ ] تطبيق الترحيل والتحقق من 61 جلسة و8,040 دقيقة لكل نسخة، 53/53، وصفر incomplete_partition وsystem_template.
- [ ] تشغيل معاينة تحسين للمسودة لمدة 15 ثانية دون تطبيقها، وتسجيل البدائل والتنقلات والمقاييس قبل/بعد.

## لوحة الإدارة العليا — المرحلتان الأولى والثانية فقط

- [x] تدقيق تسميات وحسابات النصاب والإسناد والجدولة والنشر دون خلط المفاهيم.
- [x] عرض تفاصيل المحاضرين والكليات والقاعات من المصدر الحالي، مع تمييز الناقص والتقديري.
- [x] إعادة ترتيب الصفحة كلوحة قرار RTL متجاوبة مع إبقاء الطباعة والتصدير.
- [x] اختبارات مركزة + TypeScript + build؛ فحص الدخول الآلي للمعاينة تعذّر بسبب انتهاء جلسة الاختبار، دون نشر.

- [x] إدراج محاضرة علوم البلاغة G1 (S001، 30، السبت 10–12، قاعة 32، الجحدبي) في مسودة الشريعة 8c2ec388 باستثناء cross-college معتمد صراحةً؛ الهدف 64 جلسة/8520 دقيقة.

## حالة المحاضر (availability_status)

- [x] عمود instructors.availability_status + backfill من is_active + CHECK.
- [x] تحديث RPCs (roster/update/academic_affairs) وحارس DB يمنع إسنادًا/جلسة جديدة لغير المتوفر.
- [x] حقل «الحالة» في النموذج بدل التفرغ/التعاقد، خريطة مركزية، عرض في الدليل، واختبارات.

## عزل الإسناد بحسب نسخة الجدول (ITCS d68d8d22) — كود فقط
- [x] ترحيل مقترح غير مطبق: docs/migrations-proposed/20260927_itcs_version_scoped_assignments.sql
- [x] اختبار قاعدة مؤقتة: tests/itcs-version-scoped-assignments-db.sql (PASS)
- [x] المراجعة 2: مسار طلب/قرار قانوني، تغطية بحسب النسخة، نقل ذري مع CAS، rollback حرفي
- [ ] اختبار على نسخة من مخطط الإنتاج الكامل (HOLD: لا توجد نسخة معزولة)
- [ ] بوابة الأيام/يوم الطالب مع partitions والقاعات المشتركة واستثناء الرؤساء (HOLD)
- [ ] مراجعة ثم تطبيق الترحيل على الإنتاج (ينتظر موافقة صريحة)
- [ ] اعتماد الكلية الأم للمحاضرين الثلاثة من الواجهة ثم النقل الجماعي والنشر

## ITCS cutover (Rev4 orchestrator) — HOLD
- [x] Super-Admin page /itcs-cutover: upload manifest, local CAS diff + path rules, server preview, execute
- [x] Proposed SQL docs/migrations-proposed/20260927c_itcs_cutover_orchestrator.sql (not applied)
- [x] tests/itcs-cutover-manifest.test.ts (6 pass)
- [ ] Compile Rev2+Rev3.1+Rev4 in BEGIN…ROLLBACK on production schema (blocked: needs a write-capable rolled-back session)
- [ ] 2 missing + 1 inactive cross-college requests decided by home colleges (blocked: home-college approvers)
- [ ] Apply migrations, then run cutover from the page (blocked: the two items above)
