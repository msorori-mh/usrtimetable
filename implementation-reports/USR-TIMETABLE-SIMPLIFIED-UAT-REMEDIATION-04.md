# تقرير معالجة ملاحظات القبول — الواجهة المبسطة 04

التاريخ: 2026-08-19  
الفرع: `agent/simplified-uat-remediation-04`  
خط الأساس: `1d66d29565627946bc6e4062b3c8d49ad6237e92`

## القرار

- **PASS — المصدر المحلي:** أُغلقت الملاحظات الثلاث ضمن نطاق UI/read-model فقط.
- **HOLD — القبول التشغيلي:** يلزم إعادة اختبار النسخة المنشورة على عرض 390px وبالأدوار الثلاثة قبل اعتماد الإغلاق النهائي.

## النطاق المنفذ

1. إخفاء إجراء «إضافة إلى الجدول» وحواره بالكامل عندما لا تجتمع صلاحية الدور المحلية مع `payload.can_manage` من الخادم. بقي قفل المسودة وحالة قابلية إنشاء الجلسة كما هما.
2. احتواء عرض الشبكة الأسبوعية داخل حاوية تمرير أفقي محلية، مع منع اتساع صفحة «بناء الجدول» نفسها على الجوال.
3. تحميل `scheduling_cohort_term_headcounts` باستعلام قراءة مقيّد بالكلية والفصل والدفعات الظاهرة، وربط السجل بالجلسات ذات `cohort_id`.
4. اعتماد الحالة `confirmed` والعدد الحديث فقط عندما تكون `approval_status = approved`. السجل المفقود أو غير المعتمد يبقى `unverified` بشكل fail-closed. الجلسات القديمة التي لا تحمل `cohort_id` تحافظ على سلوكها السابق.
5. منع طبقة التعديل المحلية القديمة الخاصة بـ `course_offerings` من تجاوز المصدر الحديث للجلسات المرتبطة بدفعة.

## الملفات المعدلة

- `src/components/schedule-builder/v2-work-items-panel.tsx`
- `src/components/timetable/timetable-grid.tsx`
- `src/lib/schedule-builder/queries.ts`
- `src/lib/schedule-builder/session-hydrate.ts`
- `src/lib/schedule-builder/workspace.ts`
- `src/routes/_authenticated/schedule-builder.tsx`
- `tests/harness/builder-progressive-disclosure.harness.ts`
- `tests/harness/schedule-builder-workspace-read-model.harness.ts`

## أدلة التحقق

- الاختبارات المركزة لمسار العرض والصلاحية ومصدر العدد: **PASS**.
- Harness كامل بمحمل Node المباشر: **64/64 PASS**.
- TypeScript (`tsc --noEmit`): **PASS**.
- ESLint للملفات المتغيرة: **PASS**.
- Prettier check للملفات المتغيرة: **PASS**.
- Production build (client + SSR): **PASS**.
- مشغّل `tests/harness/run.mjs` الافتراضي تعطل قبل تنفيذ الاختبارات بسبب منع قناة IPC الخاصة بـ `tsx` داخل sandbox (`EPERM`). أعيد تشغيل نفس قائمته بمحمل `node --import tsx` ونجحت 64/64.
- اختبارات `bun:test`: **غير منفذة** لأن Bun غير متوفر في بيئة التنفيذ الحالية؛ لم يُحسب ذلك نجاحًا.

## مراجعة الأمان

- لا تغييرات في migrations أو RLS أو RPC.
- لا `INSERT/UPDATE/DELETE` جديد؛ استعلام العدد الحديث `SELECT` فقط.
- الاستعلام مقيّد بـ `college_id` و`term_id` و`cohort_id`، وتبقى RLS هي حد التفويض النهائي.
- لا أسرار أو بيانات اعتماد أو بيانات إنتاج أضيفت.
- لا نشر، لا تطبيق migrations، لا push، ولا دمج ضمن هذه المرحلة.

## اختبار القبول المتبقي

1. على عرض 390px: تحقق أن `document.documentElement.scrollWidth === document.documentElement.clientWidth`، وأن الشبكة وحدها قابلة للتمرير أفقيًا.
2. مدير المؤسسة ومدير الكلية: يظهر إجراء الإضافة عندما تكون النسخة مسودة ويسمح الخادم بذلك.
3. قارئ فقط: لا يظهر زر الإضافة ولا حوارها.
4. جلسة TEST101 المرتبطة بالدفعة TESTCOH03: لا تظهر شارة «عدد الطلاب غير معتمد» بعد قراءة السجل الحديث المعتمد.
5. RTL وConsole: بلا انحدار أو أخطاء.
