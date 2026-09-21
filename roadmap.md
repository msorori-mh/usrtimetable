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
- [x] تحسين التفاصيل الأسبوعية وبنية الطباعة مع الرأس الرسمي وعدم إسقاط أي جلسة.
- [x] إضافة اختبارات الحسابات والتجميع وبنية الشاشة والطباعة، ثم تشغيل الفحوص والنشر.

## عرض سياق الإسناد التدريسي

- [x] إضافة البرنامج ونظام الدراسة من بيانات الدفعة إلى جدول الإسناد.
- [x] إظهار جميع البرامج والأنظمة المشاركة في مجموعات المحاضرات المشتركة.
- [x] تشغيل الاختبارات المركزة وTypeScript وESLint والبناء دون نشر.

## توحيد الطباعة على مستوى المنصة

- [x] تثبيت جميع التقارير ومركز الطباعة على A4 عمودي بهوامش مشتركة.
- [x] إزالة خيارات A3/الاتجاه الأفقي والاستثناءات الخاصة بالكليات والتقارير.
- [x] تحديث اختبارات الطباعة وإضافة بوابة تمنع عودة قواعد متعارضة.
- [ ] تشغيل الاختبارات المركزة وTypeScript والبناء والتحقق من المعاينة دون نشر.
