# A3 — Soft Preferences UI (A3.3) + G5 Harness Reference Fix

- **Swarm / Wave:** USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01 · WAVE-05
- **Agent:** AGENT-TIME-AVAILABILITY-A3
- **Branch:** `feat/a3-preferences-ui-g5-fix` (from `main` @ `70686c1c`) — Draft PR, base `main`
- **Date:** 2026-07-22
- **Mode:** source-only. لا DB writes، لا migration apply، لا deploy، لا commits إلى main، لا rebase/force-push.

---

## 1) G5 — إصلاح مرجع الـmigration في `tests/harness/teaching-assignments-v2-runtime.harness.ts`

### المشكلة (كما وُثّقت في PR #69)
الـharness على main يشير إلى `supabase/migrations/20260717043000_teaching_assignments_v2_runtime_foundation.sql` — ملف **غير موجود** على main، بينما محتوى Phase 9.4 الكامل يعيش فعليًا في:
`supabase/migrations/20260717035611_82eaf255-efc0-42b6-b42e-4f34ce1f1817.sql` (78,164 بايت، timestamp 2026-07-17 03:56:11).

### الإصلاح
1. **تصحيح المرجع** `MIG` إلى الملف الفعلي مع تعليق يوثّق التاريخ وأن الاسم القديم لم يصل main أصلًا. **دلالات الفحص لم تتغير** — نفس السلاسل المؤكَّدة حرفيًا.
2. **اكتشاف متابِع (موثّق بشفافية):** بعد تصحيح المرجع ظهر أن قسم «Import alignment» في نفس الـharness يشير إلى مواضع قديمة للكود بعد إعادة هيكلة A1.3a لمسار الاستيراد:
   - المفتاح الطبيعي لـV2 انتقل إلى `src/lib/excel-import/keys.ts` (`deliveryGroupIsolationKey` يتضمن `delivery_group_code` + `employee_number`).
   - حقول الحمولة تُعَدّ/تُتحقق في `validators.ts` (`_assigned_component_hours`، `_is_active`).
   - غلاف commit الدُفعي عبر RPC انتقل إلى `src/lib/academic-delivery/teaching-assignments-v2-service.ts` (`commitTeachingAssignmentsV2Import`)؛ و`excel-import/commit.ts` لم يعد يحوي أي كود V2 (يوجّه فقط إلى `commit_import_job_atomic`).
   
   عولجت بنفس أسلوب G5 المأذون به: **توجيه القراءة إلى الملفات الفعلية مع تعليقات توثيق** — رسائل الفحص ودلالاتها (natural key يشمل delivery group، لا DML مباشر، لا `weekly_hours ?? 3`، RPC دُفعي ذري موثّق) **بقيت كما هي**؛ تغيّرت المراجع فقط. أي مراجع يمكنه مقارنة السلاسل المؤكَّدة قبل/بعد: لم تُحذف ولم تُخفَّف دلالة أي فحص.
3. **`tests/harness/run.mjs`:** سُجّل `soft-preferences-ui.harness.ts`، وأُزيل إدخال `historicalArtifacts` الخاص بـteaching-assignments-v2-runtime (الملف أصبح موجودًا ومطلوبًا؛ إبقاء التصنيف المتسامح كان سيُخفي تراجعًا مستقبليًا).

### التحقق (محلي، tsx، دون استنساخ)
- نُفّذ الـharness المُصحَّح كاملًا محليًا عبر `npx tsx` على بايتات الفرع:
  - **بايتات حقيقية كاملة:** ملف الـmigration (78,164 بايت — مطابق لحجم GitHub)، `teaching-assignments-v2.ts`، `workload.ts`، `keys.ts`، `teaching-assignments-v2-service.ts`، صفحة `teaching-assignments.tsx`.
  - **بدائل موثّقة (stand-ins):** mig-9.3، `templates.ts`، `validators.ts`، `session-dialog.tsx`، `schedule-builder/queries.ts`، `workspace.ts` — كل سلسلة يفحصها الـharness في هذه الملفات تحققتُ منها **بقراءة الملف الحقيقي كاملًا عبر GitHub API** قبل بناء البديل.
- **النتيجة: `PASS — PHASE_9_4 teaching-assignments-v2-runtime harness`.**
- قبل الإصلاح كان الـharness يفشل عند أول فحص (`Phase 9.4 migration present`) ويُصنَّف `missing-historical-artifact`؛ بعد الإصلاح يمرّ فعليًا.

---

## 2) A3.3 — واجهة التفضيلات الناعمة (Soft Preferences UI)

### التحقق المسبق من المصدر الفعلي على main (إلزامي قبل البناء)
| العنصر | الحالة | الدليل |
|---|---|---|
| جدول `instructor_availability` + RLS | موجود في migration أساسية (ليست source-only) | `20260604230713_94c6fd6a-...sql` — سياسات `ia_insert/update/delete` بـ `can_manage_college`، SELECT بـ `can_view_college`، GRANT لـ authenticated |
| عمود `is_preference` | موجود في migration أساسية | `20260605011516_481f5339-...sql` — `is_preference boolean NOT NULL DEFAULT false` |
| استهلاك الـsolver | موجود على main | `src/lib/auto-scheduler/greedy.ts` يقرأ `.eq("is_preference", true)` ويسجّل: مفضّلة (`availability_type != 'unavailable'`): **+5** داخلها / **−3** خارجها؛ غير مفضّلة (`== 'unavailable'`): **−10** عند التداخل |
| RPCs للتفضيلات | **لا يوجد** — والكتابة المباشرة للجدول متاحة عبر RLS القائم | لا حاجة لأي migration جديد ولا لأي شيء source-only |

**الخلاصة:** سطح التفضيلات الناعمة **مطبّق فعلًا** (schema أساسي + solver) — لذا نُفّذت الواجهة (وليست حالة UNKNOWN/خطة فقط). لم يُبنَ شيء على migrations وسمة `source_only` (تحديدًا لم تُستخدم RPCs الجملة `upsert_*_unavailability_*` غير المطبّقة — انحراف G7).

### ما نُفّذ
- **شاشة مستقلة جديدة** `src/routes/_authenticated/instructor-preferences.tsx` بعنوان «تفضيلات المحاضرين»:
  - إدخال/عرض/حذف تفضيلات **ناعمة فقط**: كل قراءة `.eq("is_preference", true)` وكل كتابة `is_preference: true`؛ **لا** قراءة/كتابة لسجلات Hard إطلاقًا.
  - نوعان مطابقان لدلالات الـsolver: «فترة مفضّلة» (`availability_type='available'`) و«فترة غير مفضّلة» (`availability_type='unavailable'`).
  - بطاقة توضيح (`soft-prefs-semantics-note`): التفضيلات لا تمنع الجدولة (+5/−3/−10)، مستقلة عن عدم التوفر (Hard) وعن القيود الهيكلية، مع رابط توجيهي لشاشة «عدم التوفّر» للمنع الإلزامي — **فصل صريح لا خلط**.
  - «كل أيام الدوام»: إدراج مصفوفة **واحد** (عبارة INSERT واحدة ذرّية عبر الأيام) بعد تخطّي السجلات المطابقة الموجودة (idempotent)؛ أيام الدوام من `scheduling_settings` عبر نفس مساعدات `active-days.ts` المستخدمة في شاشة عدم التوفّر.
  - صلاحيات: `useCanManageActiveCollege`؛ الكتابة مقيدة كلية المستخدم عبر RLS (`can_manage_college`) + `.eq("college_id", active!.id)`؛ **read_only عرض فقط** (النموذج وأزرار الحذف مخفية + ملاحظة `soft-prefs-readonly-note`).
  - تدقيق `logAudit` عند الإنشاء/الحذف (entity: `instructor_availability_preference`).
  - لا Sections/section_id. المصطلح الرسمي «أيام وفترات الدوام» مستخدم للوقت.
- **تنقّل:** عنصر «تفضيلات المحاضرين» (أيقونة Star) ضمن مجموعة «موارد التدريس» في `src/components/app-layout.tsx` — **مستقل** عن عنصر «عدم التوفّر».
- **تسجيل المسار:** `src/routeTree.gen.ts` حُدّث يدويًا باتباع نمط الملف المولَّد حرفيًا (11 موضع إدخال: import، route const، 3 واجهات routes، 3 اتحادات أنواع، كتلة FileRoutesByPath، واجهة + ثابت children). سيُعاد توليده تلقائيًا عند أول `vite dev/build` — التحديث اليدوي يجعل الشجرة المرتكزة متسقة فورًا.
  - **ملاحظة شفافية (مراجعة ذاتية بعد فتح الـPR):** اكتشفتُ بفحص diff الـPR زلّة نسخ مني في النسخة الأولى (سطرا `parentRoute` لمسارَي `/users` و`/universities` داخل كتلة `FileRoutesByPath` النوعية فقط، وسطر فارغ زائد). أُصلحتا في commitَي `aa99870c` و`37380a91`. الـdiff النهائي للملف **+22/−0** — مواضع الإدخال المقصودة فقط، دون أي تغيير على المسارات القائمة.
- **Harness ساكن جديد** `tests/harness/soft-preferences-ui.harness.ts` (بدون imports من src — يعمل مستقلًا): يفحص وجود الدعم الفعلي (migrations الأساسية)، عقد الكتابة Soft فقط، عقد الـsolver (+5/−10/−3 ودلالات `availability_type`)، الاستقلال عن شاشة Hard وعن RPCs الجملة source-only، غياب تفضيلات القاعات (لا دعم schema)، المصطلحات، الصلاحيات/القراءة فقط، والتسجيل في التنقّل/routeTree. مُسجّل في `run.mjs`.
  - **تحقق محلي:** `PASS — A3.3 soft-preferences-ui harness (static)` عبر tsx (بايتات حقيقية للصفحة؛ مقتطفات حرفية موثّقة من الملفات الكبيرة بعد قراءتها كاملة).

### ما لم يُنفَّذ ولماذا
- **لا UI لتفضيلات القاعات الناعمة:** لا يوجد `is_preference` على `room_unavailability` في schema main — خارج نطاق «ما هو موجود فعلًا».
- **لا تعديل على شاشة عدم التوفّر** ولا على انحراف G7 (RPCs الجملة source-only في الشاشة الصلبة) — مملوك لمهام أخرى (A3.2/G7)؛ تعمدت عدم الاتكاء عليها.
- **لا اختبارات متصفح/وحدة UI** — لا بنية vitest/RTL في المستودع؛ التغطية عبر الـharness الساكن.

### UNKNOWNs (غير قابلة للإثبات من المصدر وحده)
1. **مطابقة الأنواع المولّدة:** لم يتسنَّ تشغيل `tsc`/build (لا node_modules محليًا — لا استنساخ). قراءة/تصفية `is_preference` مستخدمة فعلًا على main (greedy/availability) بنجاح؛ إدراج الصفحة للحقل يفترض أن الأنواع المولّدة للجدول تشمله. إن تعذّر التحقق النوعي في CI فالإصلاح سطحي (توسيط النوع).
2. **عدم وجود قيد فريد** على `instructor_availability(instructor, day, start, end, type)` — لم يُلاحظ في migration الأساسية؛ لذا طُبّق تخطّي-المطابق client-side. سباق متزامن نادر قد يكرر سجلًا ناعمًا (أثره تجميلي فقط على التسجيل، لا على الجدولة).
3. **حالة تطبيق migrations الأساسية على قاعدة البيانات الحية** لا تُثبت من المستودع (مصدر فقط) — لكنها جزء من السلسلة الأساسية لشهر يونيو وليست موسومة source_only، وشاشة عدم التوفّر الحالية تعتمد على الجدول نفسه.

---

## 3) الملفات
| الملف | التغيير |
|---|---|
| `tests/harness/teaching-assignments-v2-runtime.harness.ts` | G5: مرجع MIG إلى الملف الفعلي + تصحيح مراجع قسم الاستيراد (موثّق، نفس الدلالات) |
| `src/routes/_authenticated/instructor-preferences.tsx` | **جديد** — شاشة التفضيلات الناعمة |
| `src/components/app-layout.tsx` | عنصر تنقّل «تفضيلات المحاضرين» + أيقونة Star |
| `src/routeTree.gen.ts` | تسجيل المسار (نمط المولّد؛ +22/−0 نهائيًا) |
| `tests/harness/soft-preferences-ui.harness.ts` | **جديد** — harness ساكن، مسجَّل في run.mjs |
| `tests/harness/run.mjs` | تسجيل الـharness + إزالة إدخال G5 المتقادم |
| `implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/A3-PREFERENCES-UI-AND-G5-01.md` | هذا التقرير |

## 4) الفحوص المُنفّذة
- `npx tsx tests/harness/teaching-assignments-v2-runtime.harness.ts` → **PASS** (بايتات الفرع، محليًا؛ تفاصيل البايتات/البدائل في §1).
- `npx tsx tests/harness/soft-preferences-ui.harness.ts` → **PASS** (محليًا).
- فحص diff الـPR كاملًا عبر GitHub API (`get_files`) — كل الملفات السبعة تطابق التغييرات المقصودة فقط.
- لم تُشغَّل: مجموعة الـharness الكاملة (تتطلب node_modules كاملة)، ولا build/tsc — موثّق أعلاه.
