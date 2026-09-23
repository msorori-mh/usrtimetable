# تقرير تدقيق قراءة فقط: خوارزمية الجدولة التلقائية

هذا تقرير فقط. لم يُعدَّل أي ملف، ولم تُكتب بيانات، ولم يُنشر شيء. الموافقة على هذا المستند لا تنفّذ أي تغيير.

## 1) البنية
- الصفحة: `src/routes/_authenticated/auto-schedule.tsx`. عند الضغط يُستدعى `runV2AutoSchedule` من `src/lib/auto-scheduler/v2.ts`، وقيمة `ALGORITHM_VERSION = "v2-atomic-generation-repair-1"`.
- الحساب كله يجري في المتصفح: منطق TS، ومحلّل HiGHS بصيغة WASM داخل Web Worker (`compact.worker.ts`). لا يوجد توليد على الخادم ولا edge functions.
- دور قاعدة البيانات هو الكتابة الذرية وإعادة التحقق فقط، عبر `apply_schedule_generation` (آخر تعريف في migration `20260920030000`). هذه الدالة تستدعي داخليًا `apply_schedule_relayout` و`create_schedule_session_from_assignment_v2`.
- المكتبات: `session-plan.ts` (الإيقاع الأسبوعي والمرشحون)، `generation-ranking.ts` (الترتيب)، `compact.ts` (النموذج و`feasible` و`better`)، `joint-model.ts`/`joint-search.ts` (MIP)، `attendance-search.ts` (بحث شامل احتياطي)، `repair.ts`، `quality-search.ts`، `generation-transaction.ts`.
- جداول الإدخال: `teaching_assignments`، `delivery_groups`، `academic_cohorts`، `rooms`، `room_types`، `room_availability`، `time_slot_templates`، `plan_course_components`، `plan_courses`، `schedule_sessions`، `instructor_availability`، `scheduling_settings`، وجداول الشرائح والجودة.
- جداول الإخراج: `schedule_sessions`، `schedule_compaction_receipts`، `audit_logs`، `auto_schedule_runs`.

## 2) تسلسل التنفيذ
1. **Preflight:** يُعاد فحص الصلاحية، ويُعاد جلب الجاهزية بـ`fetchCollegeReadiness` دون cache، ويُرمى `READINESS_BLOCKED` عند وجود عائق حرج.
2. **درجة الجودة قبل التشغيل:** `scoreScheduleVersion` مع `persist:false`.
3. **تحميل البيانات:** `listScheduleBuilderV2WorkItems` ثم القاعات والقوالب والجلسات القائمة.
4. **تحديد النطاق:** حسب نظام الدراسة، ويُشترط `can_create_session` ووجود المجموعة والدفعة.
5. **بناء المهام:** الإيقاع من `requiredCadenceForComponent`؛ مثال: مكوّن نظري 4 ساعات يصبح جلستين × ساعتين.
6. **الترتيب:** الأصعب والأكثر تقييدًا أولًا.
7. **المرشحون:** قاعات وأوقات مرتبة، مع احتياطي `authoritative-fallback`.
8. **التحقق والبحث:** `feasible()`، ثم MIP لعدد أيام 3 ثم 4 ثم 5. يُستخدم البحث الشامل فقط عند إثبات الاستحالة، لا عند انتهاء المهلة. عند التعذر يعمل `repair`، ثم يُحسَّن التوزيع بـ`improveDistribution`.
9. **الحفظ:** نداء واحد لـ`apply_schedule_generation` يحمل النقلات والإضافات.
10. **فحص ما بعد الحفظ:** `fetchDeliveryCoverage` للقراءة فقط، حتى لا تُعرض التغطية أعلى من الواقع.

## 3) نوع الخوارزمية
الخوارزمية هجينة:
- وضع جشع مرتب حسب الصعوبة.
- MIP بمحلّل HiGHS: `mip_rel_gap 0.05` و`mip_heuristic_effort 0.2`.
- بحث احتياطي شامل مع تراجع.
- إصلاح محلي بعمق 1–2، والحدود `maxAttempts=4000` و`maxDepth=2`.
- تحسين MIP ثانٍ للتوزيع: `mip_rel_gap 0.01`.

مدة البحث قابلة للاختيار: 60 أو 180 أو 300 أو 600 ثانية، والافتراضي 180. لا يوجد seed ولا عشوائية صريحة؛ الترتيب حتمي. الملف القديم `greedy.ts` (فيه `MAX_BACKTRACKING_ATTEMPTS=50`) لا يُشغَّل من المسار الحالي؛ تُستخدم أنواعه فقط.

## 4) أوضاع التشغيل
- الواجهة تعرض ثلاثة أوضاع: `fill_missing` و`regenerate_auto` و`full_rebuild`.
- لكن `v2.ts:190-194` يرفض أي وضع غير `fill_missing` بالخطأ `V2_DESTRUCTIVE_MODE_BLOCKED`.
- إذن الوضع الفعلي الوحيد إضافة الناقص. قد ينقل حتى 32 جلسة قائمة غير مقفلة (`GENERATION_MAX_RELOCATIONS`)، ولا يحذف شيئًا.
- الجلسات المقفلة لا تُنقل.
- النسخ المنشورة أو قيد المراجعة مرفوضة من الخادم (`VERSION_LOCKED`).

## 5) القواعد
**قواعد صلبة (Hard)** — تُفحص في العميل ثم يُعاد فحصها في RPC/triggers. عند المخالفة يُرفض المرشح، أو تُلغى المعاملة كاملة بالرمز `P7502`:

| القاعدة | القيمة / المصدر |
|---|---|
| تعارض المحاضر، القاعة، المجموعة، الطلاب المشتركين | `validator.ts` + `create_schedule_session_from_assignment_v2` |
| السعة ونوع القاعة | `validator.ts:512,580` |
| توفر القاعة | `room_availability` |
| قالب نظام الدراسة (انتظام/موازي) | `time_slot_templates` |
| حد جلسات المحاضر اليومي | 3 (`MAX_INSTRUCTOR_SESSIONS_PER_DAY`، `joint-model.ts:292`) |
| ساعات المحاضر اليومية | `max_hours_per_day`، ثم إعداد الكلية، ثم 6 |
| ساعات الطالب اليومية | الإجمالي 8، النظري 6، العملي 8 (`student-daily-policy.ts`) |
| أيام الحضور | الهدف 3، الاحتياط 4، الحد الأقصى 5 (`ATTENDANCE_POLICY`)؛ `p_day_cap` بين 3 و5 على الخادم |
| الأيام الممتدة لكل شريحة | 2 |
| نافذة المحاضر الزمنية | تُفرض فقط إذا فُعّل `enforce_instructor_availability`، والافتراضي `false` |
| حالة المحاضر `availability_status` | trigger `guard_new_work_requires_available_instructor` على `schedule_sessions`، فتُرفض الإضافة فعليًا |

**تفضيلات مرنة (Soft):**
- **داخل MIP:** الأيام، والفجوات، ويوم واحد لمجموعات المادة (البند 6). هذه أوزان ثابتة في الشفرة، وغير قابلة للضبط.
- **درجة العرض (`scorer.ts`)**، وأوزانها من `quality_metrics` مع تجاوز الكلية في `college_quality_settings`: `preferred_days=5`، `workload_balance=10`، `gap_penalty=3`، `distribution_balance=5`. الدرجة = 100 − مجموع الخصومات.
- `scorer.ts` لا يغيّر نتيجة التوليد؛ يُستخدم للعرض قبل/بعد فقط.

## 6) قاعدة «مجموعات المادة في اليوم نفسه»
- **موجودة فعليًا.** `cohort-course-days.ts` يجمع المجموعات حسب `(cohort_id, plan_course_component_id)` عندما يكون للمادة أكثر من مجموعة.
- **داخل MIP** (`joint-model.ts:170-190`): تُنشأ متغيرات حضور لكل يوم، ومتغير «missing» بوزن `peerWeight = 0.25 / (7 × عدد المجموعات)`. الوزن صغير، فهي تفضيل ثانوي أدنى من أيام الحضور والفجوات، وليست إلزامًا (تعليق الشفرة: «never require common days»).
- **خارج MIP:** تُستخدم أيضًا لكسر التعادل في `better()` (`compact.ts:430-434`).
- **المواد متعددة اللقاءات:** المقارنة تتم على مجموعة الأيام لا على عددها، فمادة بلقاءين تتطابق عبر يومين. هذا صحيح منطقيًا.
- **اختلاف الساعة:** مسموح، لأن المقارنة على اليوم فقط.
- **الضبط:** غير قابلة للتعطيل ولا لتغيير الوزن من الإعدادات.
- **الاختبار:** `tests/joint-model.test.mjs`.

## 7) الحدود المستخرجة
القيم الافتراضية في `scheduling_settings`:
- الأيام من السبت إلى الخميس `[6,0,1,2,3,4]`.
- الدوام 08:00–14:00؛ ما بعد 14:00 يوم ممتد.
- الخانة 60 دقيقة.
- مدة الجلسة من ساعة إلى 3 ساعات، و`allow_3h_sessions=true`.
- الاستراحة 0، و`allow_back_to_back=true`.
- `max_daily_hours_per_instructor=6`، و`max_daily_hours_per_section=6`.

حدود المحرك: 3 جلسات يوميًا للمحاضر، و3/4/5 أيام حضور، وحدود الطالب 8/6/8 ساعات.

حدود الخادم: النقلات 32 على الأكثر، والإضافات بين 1 و512، والحمولة 1MB على الأكثر، و`statement_timeout` 120 ثانية.

## 8) المتطلبات والإيقاف (Fail-closed)
**يوقف التشغيل (حرج):**
- عدد دفعة غير معتمد (`SCHEDULING_HEADCOUNT_MISSING`).
- إسناد بلا محاضر.
- عدم وجود أي بند قابل للجدولة.

**تحذير أو استبعاد فقط:**
- مجموعة بلا إسناد: لا تدخل النطاق.
- قاعة سعتها غير مؤكدة أو بيانات نوعها ناقصة: `room_capacity_unverified` و`session_room_type_data_quality`.

**المجموعات القديمة:** لم يثبت أن `delivery_group_derivation_status` مربوطة بالـpreflight.

**المحاضر غير المتوفر:** لا يُستبعد في العميل. لا يوجد أي أثر لـ`availability_status` في `src/lib/auto-scheduler`، فيُرفض عند الإدراج في قاعدة البيانات.

## 9) السلامة
- المسودات فقط (`VERSION_LOCKED`).
- معاملة واحدة ذرية: أي رفض يلغي النقلات والإدراجات والإيصالات والتدقيق معًا.
- idempotency عبر `operation_id` مع SHA-256 في `schedule_compaction_receipts`، ويُرفض `OPERATION_ID_CONFLICT`.
- قفل `pg_try_advisory_xact_lock` يعيد `VERSION_BUSY`، مع `FOR UPDATE NOWAIT`.
- فحص `expected_revision` و`updated_at` يعيد `STALE_SNAPSHOT`.
- صلاحية `can_manage_college`.
- سجل تدقيق في `audit_logs`.
- لا يلمس المنشور.

## 10) الاختبارات المشغّلة (قراءة فقط)
- `node --test` على joint-model وgeneration-rearrangement وv2-joint-orchestration وstudent-daily-policy وinstructor-daily-sessions وcompact: **75/75 ناجحة**.
- `bun test` على auto-schedule-repair وinstructor-attendance-target وinstructor-attendance-target-priority وjawf-session-duration-01 وjawf-component-hours-cadence وconflict-check-batch-validation: **57/57 ناجحة، 160 تحققًا**.
- typecheck (`tsgo`): نظيف. آخر build: OK.
- اختبار `tests/generation-atomic-db.sql` يحتاج Postgres معزولًا في CI، فلم يُشغَّل هنا.

## 11) الفجوات
- **High:** الواجهة تعرض «إعادة توليد» و«إعادة بناء كامل» مع نافذة تحذير، لكن المحرك يرفضهما دائمًا. مسار الحذف القديم في `greedy.ts` ما زال في الشفرة دون استخدام.
- **High:** المحاضر غير المتوفر لا يُستبعد عند بناء المرشحين. المحرك قد يبني خطة كاملة ثم تُرفض المعاملة كلها في قاعدة البيانات بسبب جلسة واحدة. النتيجة آمنة لكن هدر ورسالة غير واضحة.
- **Medium:** `college_constraint_settings` لا يقرأه المحرك إطلاقًا. `constraint_types` يُقرأ فقط لربط الرموز عند حفظ نتائج الفحص (`validator.ts:800`). إعدادات تمكين أو وزن القيود الصلبة إذن بلا أثر على التوليد.
- **Medium:** أوزان `scorer.ts` القابلة للضبط لا تؤثر في التوليد. أوزان MIP ثابتة في الشفرة. أي أن تعديل أوزان الجودة من الإعدادات يغيّر الدرجة المعروضة فقط.
- **Medium:** عدم التطابق بين 6 ساعات (DB وMIP) و8 ساعات (`INSTRUCTOR_DAILY_HOURS_DEFAULT` في `student-daily-policy.ts`). المحرك يستخدم 6، والثابت 8 مضلل.
- **Medium:** نافذة توفر المحاضر معطلة افتراضيًا. هذا قرار موثق، لكنه ليس fail-closed.
- **Medium:** الإصلاح محدود (عمق 2). ولأن إعادة التوليد معطلة، فهو الوسيلة الوحيدة لتحسين مسودة ناقصة.
- **Low:** قاعدة اليوم نفسه وزنها صغير جدًا، فقد تُضحّى أمام تحسين طفيف في الفجوات. لا توجد إعدادات لها.
- **Low:** `qualityScoreAfter` يُحسب في العميل، ولا يُعاد التحقق منه من قاعدة البيانات بعد الحفظ.

## 12) الحكم
| المحور | الحكم |
|---|---|
| فهم البنية | PASS |
| صحة القيود الصلبة | PASS (مزدوجة: عميل + قاعدة بيانات)، مع ملاحظة المحاضر غير المتوفر |
| جودة التحسين المرن | HOLD (أوزان ثابتة، والإعدادات لا تؤثر، وقاعدة اليوم نفسه ضعيفة الوزن) |
| سلامة حفظ المسودة | PASS |
| جاهزية الاعتماد المؤسسي | HOLD حتى تُحسم الفجوات High والإعدادات التي لا تعمل |

## الخطوات المقترحة إن رغبت لاحقًا (غير منفذة)
1. إخفاء وضعي إعادة التوليد وإعادة البناء، أو وسمهما «غير متاح».
2. استبعاد المحاضر غير `available` مبكرًا، برسالة عربية واضحة.
3. ربط الإعدادات بالمحرك، أو إخفاء ما لا يعمل منها.
4. توحيد ثابت ساعات المحاضر اليومية.
