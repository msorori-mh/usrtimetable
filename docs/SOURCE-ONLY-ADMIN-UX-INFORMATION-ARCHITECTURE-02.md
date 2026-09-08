# SOURCE_ONLY_ADMIN_UX_INFORMATION_ARCHITECTURE_02

**Baseline:** `81dc3fb5a0de848204c816709e0ca9082a02ac92`
**النطاق:** واجهة المصدر والمعاينة فقط — لا migration، لا SQL، لا نشر، لا تعديل RBAC/RLS.

## 1) الملفات

### مضافة

- `src/lib/admin-nav.ts` — كتالوج موحّد لكل صفحات الإدارة: المسار، التسمية، وصف عربي قصير،
  الأيقونة، `roles` (نفس مصفوفة الأدوار السابقة حرفياً)، `tier` (أساسي/متقدم)، `journey`
  (المؤسسة والصلاحيات، البنية الأكاديمية، الكادر والقاعات، أوقات العمل والتوفر، تجهيز الجدولة،
  تنفيذ الجدول والتحقق، البيانات والاستيراد، التقارير) + `LEGACY_ADMIN_PAGES` للمسارات القديمة
  والتشخيصية + `CORE_PATH` (الروابط الستة) + `canAccess` / `matchesQuery` / `pagesByJourney` /
  `resolveBreadcrumb`.
- `src/routes/_authenticated/admin-tools.tsx` — بوابة «مركز الأدوات الإدارية» للقراءة فقط: بحث
  فوري، بطاقات مجمّعة حسب رحلة العمل، شارة أساسي/متقدم، بيان من يمكنه الوصول، وقسم مطوي
  «أدوات قديمة وتشخيصية» مع تحذير.
- `tests/harness/admin-ux-information-architecture.harness.ts` — حرّاس ثبات المرحلة.
- `tests/harness/nav-source.ts` — مساعد مشترك للاختبارات يقرأ «مصدر التنقل الأساسي» =
  `app-layout.tsx` + الكتالوج بدون قائمة legacy.

### معدّلة

- `src/components/app-layout.tsx` — وضع افتراضي «المسار التشغيلي» (الرئيسية، 1 تجهيز البيانات،
  2 بناء الجدول، 3 المراجعة والاعتماد، 4 النشر والجداول الرسمية، التقارير) بشارات خطوات، وصف
  للمجموعة الحالية، حالة نشطة قوية؛ وضع «كل الأدوات» ببحث فوري وأقسام قابلة للطي تعرض مجموعة
  المسار الحالي فقط افتراضياً؛ تخزين الوضع في `localStorage` بمفتاح `usr.admin.navMode`؛
  breadcrumb (القسم ← الصفحة) واسم الكلية النشطة؛ قائمة الجوال عبر `Sheet` بدل `details` مع
  الإغلاق بعد الانتقال.
- `src/components/ui/tabs.tsx` — نمط تبويبات مؤسسي: قائمة بحدود وخلفية هادئة، تمرير أفقي على
  الجوال بلا التفاف أو قص، RTL صحيح، active بلون primary مع علامة ذهبية (`--usr-gold`)،
  وحالات hover/focus-visible/disabled واضحة.
- `src/routes/_authenticated/reports.index.tsx` — تقارير Legacy خارج الأقسام الأساسية في قسم
  مطوي (`data-testid="reports-legacy-section"`).
- `src/routes/_authenticated/data-cleanup.tsx` — إزالة `flex-wrap` من `TabsList` لتفعيل التمرير.
- `tests/harness/run.mjs` + 12 harness تنقل قائمة — تقرأ الآن مصدر التنقل من المساعد المشترك
  بعد انتقال الكتالوج من `app-layout.tsx` إلى `src/lib/admin-nav.ts`.

## 2) القرارات

- `/sections` و`/course-offerings` و`/timetable` و`/import-templates` و`/time-slots` القديمة
  والتقارير القديمة: مخفية من التنقل الأساسي، متاحة عبر الرابط المباشر وعبر القسم المطوي في
  `/admin-tools`. لم يُحذف أي route.
- `/delivery-groups` = «مجموعات المحاضرات والمعامل»، `/academic-cohorts` = «الدفعات الدراسية»،
  `/time-slot-templates` = مرجع أوقات المحاضرات، `/time-slots` = «ساعات وفترات الدوام» مع وصف
  يوضح الفرق.
- `data-templates` + `import` + `import-history` في رحلة «البيانات والاستيراد» الواحدة،
  و`import-templates` ضمن الأدوات المتقدمة/القديمة.
- الأدوار: `ALL` يبقى بالأربعة أدوار كما كان، و`/users` و`/colleges` و`/universities` تبقى
  super_admin + institutional_viewer، و`/import` و`/data-cleanup` و`/auto-schedule` تبقى
  بنفس نطاق الكتابة السابق. `/admin-tools` يخضع لحاجز `_authenticated` نفسه ويصفّي البطاقات
  بنفس المصفوفة.

## 3) الاختبارات

- harness جديد يثبت: ثبات مصفوفة الأدوار، ظهور الروابط الستة، غياب `/sections` وتقارير Legacy
  عن التنقل الأساسي، احترام `/admin-tools` للأدوار، وحالات active/focus/overflow وRTL للتبويبات.
- تسميتان في harness سابق حُدّثتا لتتبعا التسمية الرسمية الجديدة فقط
  («المسار التشغيلي»/«كل الأدوات» و«ساعات وفترات الدوام») — دون إضعاف أي تأكيد أمني.

## 4) نتائج التحقق

| بوابة | النتيجة |
| --- | --- |
| prettier (الملفات المعدلة فقط) | PASS |
| typecheck (`tsgo --noEmit`) | PASS |
| lint (الملفات المعدلة) | PASS — تحذيرات لا شيء، وخطأ `no-explicit-any` قائم مسبقاً في `data-cleanup.tsx:93` خارج نطاق التعديل |
| `bun test` | 66 pass / 0 fail |
| harness suite | 66 passed / 0 failed |
| build | build OK |
| المعاينة | تعمل بلا أخطاء console؛ الشاشات المصادَقة لم تُفتح آلياً لعدم توفّر جلسة اختبار (`auth signed_out`, minting unavailable) |

## 5) الحالة

**PASS** لبوابات typecheck والاختبارات والharness والbuild وتحميل المعاينة.
التحفّظ الوحيد: التحقق البصري للشاشات المصادَقة يحتاج تسجيل دخول من المستخدم في المعاينة.

## 6) مراجعة الأمان

- migrations: لا · RLS: لا · RPCs: لا · Authentication: لا · Authorization: لا
- تعرّض بيانات حساسة: لا · تصعيد صلاحيات: لا · أثر production: لا شيء
- جاهز للدمج: نعم · جاهز للنشر: لم يُطلب ولم يُنفَّذ
