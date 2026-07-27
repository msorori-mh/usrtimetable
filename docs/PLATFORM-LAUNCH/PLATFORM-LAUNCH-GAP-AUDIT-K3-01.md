# PLATFORM-LAUNCH-GAP-AUDIT-K3-01

تدقيق مستقل ثالث (K3) لفجوات إطلاق منصة الجداول الدراسية — قراءة فقط على المصدر، بلا أي كتابة إنتاجية.

- المرجع: `msorori-mh/usrtimetable`
- بيئة التدقيق: worktree معزول `C:\Projects\usrtimetable-k3-launch-audit` على فرع `k3/platform-launch-gap-audit-01`
- تاريخ التدقيق: 2026-07-27/28
- نطاق الحظر الالتزامي: لا دمج PRs، لا Lovable Publish، لا DB writes، لا تطبيق migrations، لا إنشاء/تعديل بيانات أكاديمية إنتاجية. التزم هذا التدقيق بذلك كاملاً.

---

## EXECUTIVE_SUMMARY

الحالة المبلَّغة قبل التدقيق كانت متفائلة أكثر من الواقع في نقاط حاسمة، ومتأخرة عن الواقع في نقاط أخرى:

- **ما تحقق كصحيح**: PR #95 مدمج فعلاً (وليس مجرد Ready) برأس مطابق للمبلَّغ `bd66f8a…` وCI أخضر؛ PR #96 مدمج؛ harness يمر محلياً؛ الأمن النظيف للـ migrations ممتاز (كل SECURITY DEFINER مثبَّت search_path، صفر منح لـ anon، تغطية RLS شبه كاملة، عزل الكليات بثلاث طبقات).
- **ما تبقّى مانعاً فعلياً للإطلاق (5 عناصر P0)**:
  1. مستورد الإسناد لا يستطيع استيراد الملف الحقيقي (READY=0 موثق + عيوب مصدرية مؤكدة في resolver تجعل الفشل شاملًا حتى بعد إصلاح aliases).
  2. الجاهزية (readiness) تعمل Fail-Open: فشل أي استعلام يتحول إلى «جاهز» ويفعّل زر الجدولة.
  3. بوابة نشر الجدول الرسمي غير موجودة في قاعدة البيانات المطبَّقة: دورة الحياة الذرية SOURCE-ONLY فقط، وRLS الحالي يسمح بنشر مباشر يتجاوز الجودة والتعارضات.
  4. الموقع الحي على نشر أقدم من main ولا مسار نشر مؤكد (Lovable Publish محجوب).
  5. سجل migrations الإنتاجي غير موثوق (انجراف موثق: 35 ملفًا وصفيًا، ~30 توأم UUID، إعادة إصدار headcount بمفتاحين) ويجب تسويته قراءةً أولاً قبل أي تطبيق.
- **9 مخاطر P1** تشمل ابتلاع أخطاء المجدول التلقائي، غياب كشف تعارض delivery-group، بقاء `section_id` هويةً تشغيلية في التدفق الجديد، وثغرات RBAC تحتاج تحققًا حيًا.
- القرار النهائي: **HOLD** — انظر FINAL_DECISION.

---

## VERIFIED_CURRENT_STATE

| البند | القيمة | التصنيف |
|---|---|---|
| ORIGIN_MAIN_SHA | `62245a3bf4f49091177d6248c3bc8e05ddbfb90d` | VERIFIED |
| LOCAL_MAIN_SHA | `62245a3bf4f49091177d6248c3bc8e05ddbfb90d` (مطابق) | VERIFIED |
| PR #95 | **MERGED** في 2026-07-27T21:28:02Z، merge commit `26fa5121667e19dc20544e197ef2b17d6d74cdb4`، head `bd66f8a76ecd0541b095ec221ee7152ad96cdf20` (مطابق للمبلَّغ)، base main | VERIFIED — الحالة الفعلية «مدمج» وليست «Ready» كما بُلِّغ |
| PR #95 checks | runtime-gates: pass ×2 | VERIFIED |
| PR #96 | MERGED في 2026-07-27T20:34:30Z، merge commit `714084056d877e1076b92cf933bc116ebd3d2a8c` | VERIFIED |
| CI على origin/main | runtime-gates آخر تشغيل على `62245a3`: **success** (فشل واحد تاريخي على `7984195` عولج بإصلاح whitespace في `ee1f9e2`) | VERIFIED |
| runtime-gates محليًا | المكافئ المحلي (diff-check + tsc + build + harness): انظر TEST_RESULTS | VERIFIED |
| worktree الأصلي (Cursor) | نظيف — لا ملفات غير متعقبة ولا تعديلات (`git status --short` فارغ) | VERIFIED |
| Harness | 48 passed / 0 failed / 0 missing — انظر TEST_RESULTS | VERIFIED (مطابق للمبلَّغ) |
| الموقع الحي gomufadhala.com | نشر قديم (`x-deployment-id=71b93a56…`)، علامات PR90/PR95 غائبة — **لم يتحقق K3 منه حيًا**؛ موثق في FINAL-REPORT/STATE | REPORTED_BUT_UNVERIFIED (قراءة حية مطلوبة من Cursor) |
| Lovable Publish | محجوب (`B-LOVABLE-PUBLISH-UNAVAILABLE`) | REPORTED_BUT_UNVERIFIED |
| كتابات إنتاجية مزعومة (144 plan rows، 64 دفعة، 181 delivery_group) | موثقة في FINAL-REPORT:59-60 | REPORTED_BUT_UNVERIFIED (استعلامات قراءة مطلوبة) |
| نتيجة معاينة الاستيراد الحي | READY=0 / IMPORTED=0 / BLOCKED=252 | REPORTED_BUT_UNVERIFIED — لكنها **متسقة** مع العيوب المصدرية المؤكدة في A4 |
| «PR #95 Ready وغير مدمج» | بُلِّغ هكذا في المهمة | CONTRADICTED — مدمج فعلاً |
| اكتمال كتالوج CS/CIS/IT | تقارير متعارضة | CONTRADICTED — الكتالوج «حُمِّل» لكنه غير كافٍ للاستيراد (164 course_not_found) |
| استيراد الفصل الثاني | لم يحدث إطلاقًا (IMPORTED=0) | VERIFIED كعدم إتمام |
| انجراف migration history | أدلة مصدرية قوية (توائم + 35 ملفًا وصفيًا) | VERIFIED كخطر مصدري؛ الحالة الإنتاجية UNKNOWN حتى استعلام Cursor |

### PRs مفتوحة ذات صلة بالإطلاق (11)

87 (plan component room types)، 84 (headcount explicit-any)، 78 (preferences UI)، 77 (shared lecture groups UI)، 75 (audit/readiness UI)، 74 (workload UI)، 73 (shared lecture groups authz — NOT APPLIED)، 70 (lifecycle transitions — NOT APPLIED)، 69 (workload policies)، 66 (shared lecture groups domain — NOT APPLIED)، 30 (Phase 9.2 import generator). أغلبها قديم (2026-07-16 → 24) ومصنّف source-only NOT APPLIED — تحتاج تسوية (إغلاق أو إحياء مرتب) قبل الإطلاق لتجنب PRs متوازية تعدل الملفات نفسها. **ملاحظة: PR #70 و#73 يتقاطعان موضوعيًا مع P0-3 (دورة الحياة) وP1-legacy (الحظر الكتابي)**.

### فروع بعيدة غير مدمجة ذات صلة

`codex/platform-product-e2e-completion-01` (مدمجة)، `cursor/platform-final-operational-completion-01`، وسلسلة `codex/*` و`feat/*` القديمة (a1-1، a2-1/2/3، a3-*، availability-all-active-days، import-pipeline-safety-agent، harness-reliability-agent، migration-reconciliation-01، إلخ). لم يُفحص كل فرع على حدة؛ التوصية في PR reconciliation.

### آخر commits موضوعية (origin/main)

- import V2: `7140840` (#96 honorific matching)، `90` (استيراد من المصنف)، `7f5641a` (استعادة migration Phase 9.4)
- readiness: `63a8adb`, `65959bc`, A1.5 commits (read-model + fail-closed metrics)
- scheduler: `1f407b3` (إكمال UX)، commits Lovable غير وصفية (`f4c4713`…)
- RBAC: **لا يوجد أي commit يذكر RBAC** — كل التغطية harness/static فقط
- migrations: `da55fe1` (#91)، `47a6603` "Applied scheduling migrations" (من جهة Lovable — مرشح انجراف يجب مطابقته مع schema_migrations)

---

## CONTRADICTIONS

| # | الادعاء | التقرير المصدر | الدليل الفعلي | القرار الصحيح | الإجراء المطلوب |
|---|---|---|---|---|---|
| C-1 | «كتالوج CS/CIS/IT مكتمل/مُحمَّل (144 rows committed)» | FINAL-REPORT:59 | نفس التقرير: READY=0 مع 164 course_not_found + 19 unknown_program بعد التحميل | الكتالوج محمَّل جزئيًا لكنه **غير كافٍ** للاستيراد الحقيقي | استعلام قراءة من Cursor + إغلاق فجوة المنهج/المستوى/الفصل قبل إعادة الاستيراد |
| C-2 | «ورقتا الفصلين حُللتا والاستيراد جاهز» | CODEX-FINAL-SOURCE-ASSURANCE:19 | FINAL-OPERATIONAL-RUNLOG:15: IMPORTED=0، الالتزام تخطّي؛ تحليل offline متفائل (6 aliases) مقابل الحي (19 unknown_program) | لم يتم أي استيراد فعلي؛ جاهزية المستورد غير مثبتة | إصلاحات A4 ثم معاينة حية جديدة |
| C-3 | «PR #95 Ready ويجب أن يبقى غير مدمج» | CODEX-FINAL-SOURCE-ASSURANCE:46 | مدمج فعلاً `26fa512` | تجاوزه الزمن — لا إجراء رجعي | توثيق فقط |
| C-4 | «/sections معزول ومخفي» مقابل «/sections CRUD-visible BLOCKER (DEV-01)» | CODEX-ROUTE-AUDIT:47 مقابل DOMAIN-ENTITY-SOURCE-OF-TRUTH-MATRIX:93 | المسار مولَّد في routeTree لكنه غائب من التنقل والكتابة محجوبة client-side (`LEGACY_SECTIONS_WRITE_BLOCKED`)؛ لكن `sections` تُقرأ في أسطح نشطة أخرى | المعزول هو مسار CRUD فقط؛ الاعتماد التشغيلي عبر `section_id` ما يزال حيًا | إغلاق P1-LEGACY-SECTION-ID |
| C-5 | أرقام harness المتدرجة 46/0/1 → 47/0/0 → 48/0/0 | STATE/INTEGRATION-LOG/CODEX-REPORT | 48/0/0 مؤكد محليًا على 62245a3 | الرقم الحالي صحيح؛ الأقدم تاريخي | لا شيء |
| C-6 | «CI غير مهيأ إطلاقًا» | TIMETABLE-PROJECT-EXECUTION-STATE:27 (2026-07-18) | runtime-gates يعمل وينجح على main | تاريخي متجاوز | لا شيء |
| C-7 | عدد ملفات migrations: 94 مقابل 102 baseline | EXECUTION-STATE:44 مقابل MIGRATION-RECONCILIATION-MATRIX:251 | العدد الفعلي في المصدر الآن: **111 ملفًا** | كل الأرقام القديمة متجاوزة | تحديث التوثيق أثناء التسوية |
| C-8 | «الجاهزية fail-closed في /auto-schedule» | CODEX-REPORT:11، CODEX-FINAL-SOURCE-ASSURANCE:20 | `readiness.ts:197-239` لا يفحص `.error` ويستخدم `data ?? []` → فشل الاستعلام = جاهز | الادعاء **خاطئ مصدريًا** — fail-open مؤكد | إصلاح P0-READINESS-FAILOPEN |

---

## CLOSED_ITEMS

| العنصر | دليل الإغلاق |
|---|---|
| PR #95 مدمج بCI أخضر ورأس مطابق للمبلَّغ | gh + git log |
| PR #96 (honorific matching) مدمج واختباره يغطي الحالة الحرفية | `7140840`، harness:253-261 |
| PostgREST relationship disambiguation | PR #88 + harnesses |
| SECURITY DEFINER بدون search_path | **صفر حالة** من 107 تعريفات (A6) |
| GRANT لـ anon/public على جداول حساسة | صفر (A6) |
| atomic import commit design | `commit_import_job_atomic` سليم تصميميًا (A4-9) — بشرط تأكيد تطبيقه إنتاجيًا (موسوم SOURCE-ONLY في الترويسة، انظر P0-3/P1-APPLIED-STATE) |
| عزل cross-college في المستورد والـ RPCs | مؤكد ساكنًا (A4-6، A7) |
| B-GITHUB-PR-AUTH (حظر GitHub سابقًا) | PRs تُفتح وتُدمج الآن |

---

## P0_BLOCKERS

### P0-IMPORT-REAL-FILE — المستورد عاجز عن استيراد الملف الحقيقي

- **الدليل**: معاينة حية موثقة READY=0/BLOCKED=252 (FINAL-REPORT:30-48)؛ عيوب مصدرية مؤكدة:
  1. لا carry-forward لعمود البرنامج بين الصفوف المدمجة (`teaching-assignments-source-resolver.ts:434-437` + `program-aliases.ts:46-47`) — مع 24 تسمية برنامج مقابل 131 صفًا، هذا كافٍ وحده للفشل الشامل.
  2. جدول aliases (12 تسمية فقط، `program-aliases.ts:12-17`) لا يغطي التسميات الست الموثقة للملف الحقيقي (`كل الأقسام مع الجوف`، `امن سبراني`، `الموازي`، مركّبات الجوف/مارب).
  3. **خلل expand_all**: كل مكوّن يأخذ إجمالي ساعات الصف بدل ساعاته (`...-source-resolver.ts:368-371,402-405`) → رفض خادمي مؤكد `CO_TEACHING_HOURS_OVER_ALLOCATED` (`20260717043000:1027-1029`) يتراجع عن الدفعة كلها. **أي صف expand_all = فشل مؤكد عند التأكيد رغم أن المعاينة تقول MATCHED.**
  4. استبعاد صامت لأوراق كاملة عند اختلاف الترويسة حرفيًا (`...-source-parser.ts:88-90,178`) — فقدان صفوف بلا عدّاد.
- **الطبقة**: import (مصدر) + بيانات (الكتالوج الناقص).
- **الجذر**: تطوير المستورد على عيّنات نظيفة دون الملف الحقيقي (الملف لم يكن متاحًا محليًا — INTEGRATION-LOG:29).
- **الأثر**: لا يمكن إدخال بيانات الإسناد → لا readiness → لا جدولة → لا إطلاق.
- **النوع**: مصدرية + بيانات.
- **المسؤول**: Codex (إصلاحات resolver/aliases/carry-forward) ثم Cursor (معاينة حية + التزام).
- **الحل**: (أ) إضافة carry-forward للبرنامج والساعات؛ (ب) توسيع aliases بالتسميات الست مع معالجة صريحة لـ«الموازي» كمؤشر نظام دراسة لا برنامج؛ (ج) إصلاح توزيع الساعات في expand_all ليستخدم ساعات كل مكوّن؛ (د) جعل استبعاد الأوراق/الصفوف مرئيًا بعدّاد وسبب؛ (هـ) regression tests لكل بند.
- **عدم التعارض**: كل التعديلات في `src/lib/excel-import/teaching-assignments-*` + `program-aliases.ts` + harness جديد — لا تتقاطع مع أعمال Cursor التشغيلية؛ PRs المفتوحة 87/84 لا تلمس هذه الملفات (87 يلمس plan component room types — تحقق عند التنفيذ).
- **بوابة القبول**: معاينة حية على الملف الحقيقي: READY ≥ 95% من الصفوف، BLOCKED=0 غير مفسَّر، ثم التزام ناجح وidempotent (إعادة التشغيل = unchanged).
- **Rollback**: الالتزام ذري (تراجع كامل عند الفشل) + وضع update/upsert معكوس؛ لا حذف يدوي.
- **الترتيب**: المرحلة 7 (تسبق readiness closure).

### P0-READINESS-FAILOPEN — الجاهزية Fail-Open

- **الدليل**: `src/lib/reports/readiness.ts:197-239` — الاستعلامات الثمانية لا تفحص `.error` وتستخدم `data ?? []`؛ `auto-schedule.tsx:71-77` لا يولّد مانعًا إلا عند `critical && missing>0`؛ الدالة لا ترمي أبدًا فلا يتفعّل `isError`. النتيجة: فشل الشبكة/RLS/انقطاع = «جاهز» + زر تشغيل مفعّل. كذلك total=0 (كلية فارغة) = جاهز عمليًا.
- **الطبقة**: readiness/frontend.
- **الجذر**: نمط `data ?? []` المنتشر؛ غياب اختبار لسلوك الخطأ.
- **الأثر**: قرارات جدولة على بيانات غير مقروءة؛ إنتاج جداول ناقصة بثقة زائفة.
- **النوع**: مصدرية.
- **المسؤول**: Codex.
- **الحل**: فحص `.error` في كل استعلام والرمي (fail-closed) + حالة `unknown` صريحة تعطّل التشغيل + اختبار regression.
- **عدم التعارض**: ملفان فقط (`readiness.ts`, `auto-schedule.tsx`) + اختبار؛ PR #75 المفتوح (readiness UI) قديم ويجب إغلاقه أو إعادة تأسيسه بعد هذا الإصلاح.
- **بوابة القبول**: اختبار يثبت أن فشل استعلام = تعطيل التشغيل + رسالة؛ فحص يدوي بفصل الشبكة.
- **Rollback**: revert الـ commit (سلوك قديم أسوأ لكن لا كسر بيانات).
- **الترتيب**: المرحلة 8.

### P0-PUBLISH-GATE-MISSING — بوابة نشر الجدول الرسمي غير مطبَّقة

- **الدليل**: `transition_schedule_version` معرَّفة حصريًا في `20260718120000_source_only_atomic_schedule_version_lifecycle.sql:1` (SOURCE-ONLY/NOT APPLIED)؛ RLS المطبَّق `sv_update` يسمح لأي `can_manage_college` بـ UPDATE كامل بما فيه `status` (`20260605013524:19,27-29`). العميل يستدعي RPCs قد تكون غير موجودة (`lifecycle.ts:197`, `scorer.ts:230,266`). النتيجة: (أ) تدفق النشر الرسمي قد يفشل وقت التشغيل PGRST202، و(ب) النشر المباشر bypass متاح لأي college_admin متجاوزًا الجودة والتعارضات واعتماد المراجعة.
- **الطبقة**: DB/RLS/RPC + دورة الحياة.
- **الجذر**: تراكم migrations source-only لم تُطبَّق ولم يُسوَّ سجلها.
- **الأثر**: نشر جدول رسمي معيب بلا بوابات؛ أو تعطّل النشر كليًا.
- **النوع**: إنتاجية (حالة تطبيق) + مصدرية.
- **المسؤول**: Cursor (تطبيق migration بعد preflight وموافقة إنتاج) بمساندة Codex إن احتاجت المراجعة تعديلاً.
- **الحل**: تأكيد حالة التطبيق (استعلام الخطوة الصفرية في RBAC matrix) → تطبيق `20260718120000` (إنشاء RPCs + REVOKE UPDATE المباشر على status) → اختبار سلبي: نشر مباشر = 42501.
- **عدم التعارض**: تطبيق DB فردي من Cursor وحده؛ PR #70 المفتوح يتقاطع موضوعيًا — يُغلق أو يُدمج ترتيبه قبل التطبيق.
- **بوابة القبول**: نشر عبر RPC ينجح فقط مع تقرير جودة حديث وصفر تعارضات غير معتمدة؛ UPDATE المباشر مرفوض.
- **Rollback**: إسقاط الـ RPCs وإعادة GRANT UPDATE (موثق في قسم التراجع للـ migration نفسها).
- **الترتيب**: المرحلة 4 (تسوية migrations) ثم إلزامي قبل المرحلة 9 (E2E) و14.

### P0-LIVE-DEPLOY-STALE — الموقع الحي أقدم من main ومسار النشر غير مؤكد

- **الدليل**: موثق `x-deployment-id=71b93a56…` قديم وعلامات PR95 غائبة (FINAL-REPORT:9)؛ Lovable Publish محجوب (B-LOVABLE-PUBLISH-UNAVAILABLE). لم يتحقق K3 حيًا (خارج النطاق).
- **الطبقة**: نشر/تشغيل.
- **الأثر**: حتى بعد إغلاق كل شيء مصدريًا، لا إطلاق فعلي بلا مسار نشر.
- **النوع**: إنتاجية.
- **المسؤول**: Cursor + المستخدم (صلاحيات Lovable/النشر).
- **الحل**: تحديد مسار النشر (Lovable publish أو بديل موثق) + نشر build واحد لكل مجموعة إصلاحات مترابطة + تحقق بصمة النشر بعد كل نشر.
- **بوابة القبول**: `x-deployment-id` يطابق الـ build المتوقع وعلامات الإصدار ظاهرة.
- **Rollback**: إعادة النشر السابق.
- **الترتيب**: المرحلة 5.

### P0-MIGRATION-DRIFT-UNVERIFIED — سجل migrations الإنتاجي غير موثوق

- **الدليل المصدري**: 111 ملفًا؛ **35 ملفًا بأسماء وصفية** (غير UUID)؛ **~30 توأمًا متطابقًا** بوصفي+UUID (جدول A6)؛ إعادة إصدار headcount بمفتاحين (`20260721180000` معلن NOT APPLIED مقابل `20260724002012` معلن Applied)؛ commit `47a6603` "Applied scheduling migrations" من جهة Lovable؛ ملف `20260715130000_reset_experimental_schedule_data.sql` **مدمّر** يجب ألا يكون طُبِّق أبدًا.
- **الأثر**: أي تطبيق migration جديد دون تسوية قد يكرر كائنات أو يفشل أو يخفي انحرافًا؛ P0-3 وP1s كثيرة تعتمد على معرفة ما هو مطبَّق فعلاً.
- **النوع**: إنتاجية.
- **المسؤول**: Cursor (استعلامات قراءة فقط ثم خطة repair).
- **الحل**: تنفيذ PRODUCTION_READONLY_QUERIES_FOR_CURSOR (أدناه) → بناء مصفوفة applied vs source → `supabase migration repair` للمفاتيح الناقصة بعد مطابقة md5 → لا تطبيق جديد قبل الإغلاق.
- **بوابة القبول**: لكل كائن runtime حرج (move RPC، ensure_ss_college، generate_cohort_curriculum، headcount RPCs، commit_import_job_atomic، transition_schedule_version) تعريف إنتاجي مطابق لأحدث مصدر مقصود، وسجل `schema_migrations` مفسَّر 100%.
- **Rollback**: عمليات repair لا تغيّر مخططًا؛ أي تطبيق لاحق له rollback خاص.
- **الترتيب**: المرحلتان 3-4.

---

## P1_RISKS

### P1-SCHEDULER-ERROR-SWALLOW — المجدول التلقائي يبتلع أخطاء القراءة

- الدليل: `greedy.ts:171-175,178-183,214-216,121-124,154-158` (`?? []` بلا فحص خطأ) → فشل قراءة العروض = `completed` فارغة (`:617`)؛ فقدان حصة أثناء التراجع = تحذير فقط (`:550-554`)؛ أخطاء حذف full_rebuild غير مفحوصة (`:129-150`).
- المسؤول: Codex. القبول: فشل أي قراءة مدخلات = run failed مع سبب؛ لا completed فارغة. الترتيب: قبل المرحلة 9.

### P1-DELIVERY-GROUP-CONFLICT-GAP — تعارض الدفعة/مجموعة التدريس غير مكشوف

- الدليل: لا `delivery_group_id` في `_ss_gather` ولا `validateProposed`؛ التغطية الوحيدة `_sb_v2_delivery_group_overlap` في `20260717093000` الموسوم NOT APPLIED. المجدول قد يضع مجموعتين من نفس الدفعة في نفس الوقت دون رصد في بوابة النشر.
- المسؤول: Codex (إن شمل إصلاح validator/greedy) + Cursor (تطبيق migration). الترتيب: قبل المرحلة 9.

### P1-LEGACY-SECTION-ID — `section_id` هوية تشغيلية حية في التدفق الجديد

- الدليل (A3): `session-dialog.tsx:138-149` يقرأ `sections` ويكتب `section_id`؛ schedule-builder يقرأ `sections`/`section_subgroups` (`queries.ts:90-91,153-163`)؛ greedy يمرّر `section_id` (`greedy.ts:181`)؛ conflict partition على `section_id` (`validator.ts:293-312`)؛ RPC `create_schedule_session_from_assignment_v2` يكتبه (`20260717093000:632,700,718`)؛ `approve_capacity_split_proposal` يقرأ `sections` ويكتب `section_subgroups`؛ حظر الكتابة على DB في `20260721090000` غير مطبَّق.
- الأثر: التدفق الجديد هجين؛ قرارات إزالة legacy مؤجلة تتراكم.
- المسؤول: Codex (خطة استبدال بإسقاط cohort/DG) + المستخدم (قرار مصير ميزة تقسيم السعة). الترتيب: P1 — لا يمنع إطلاقًا محدودًا لكن يجب إغلاقه أو توثيق استثنائه قبل قرار الإطلاق.

### P1-STUDY-SYSTEM-BOTH-BYPASS — ثغرة `study_system='both'`

- الدليل: شرط `OR system='both'` في `greedy.ts:247`, `validator.ts:486`, `ss_template_conflicts.sql:8` يُفلت جلسات both من قوالب النظام؛ وغياب قوالب النظام يسقط لنوافذ الإعدادات العامة (`greedy.ts:257-264`) — محاضرة انتساب قد توضع في دوام انتظام.
- المسؤول: Codex. الترتيب: قبل المرحلة 9.

### P1-HEADCOUNT-NOT-CONSUMED — العدد المعتمد لا يغذّي المجدول

- الدليل: greedy يستخدم `expected_students` القديم (`greedy.ts:323`)؛ الاعتماد يُفرض فقط عند توليد delivery groups (`resolve.ts:23-31`). سعة القاعات قد تُفحص على أرقام قديمة.
- المسؤول: Codex. الترتيب: قبل المرحلة 9.

### P1-READINESS-COVERAGE-GAPS — فحوص جاهزية مفقودة

- الدليل (A5-1): لا فحص لـ: active study plan، اكتمال cohort curriculum، كفاية أنواع القاعات المطلوبة، time_slot_templates، instructor_availability، room_availability، scheduling_settings. الجاهزية قد تقول READY مع غياب قوالب الوقت أو التوفر.
- المسؤول: Codex. الترتيب: المرحلة 8 (مع P0-READINESS-FAILOPEN).

### P1-RBAC-GAPS — ثغرات صلاحيات تحتاج إغلاقًا/تحققًا حيًا

- C1: نشر مباشر متاح (مرتبط بـ P0-3). C2: كتابة legacy متاحة لـ college_admin (مرتبطة بـ P1-LEGACY). C4: bootstrap — أول مستخدم بعد حذف كل super_admin يصبح super_admin (`20260604222725:40-44`). C5: `is_super_admin(uuid)` قابلة للاستدعاء لأي UUID (تعداد أدوار). C7: إغراق audit_logs بلا حد. P3: التحقق من إعداد signup العام. P5: التحقق الحي من رفض الحمولة المختلطة الكليات.
- المسؤول: Codex (C4/C5/C7 مصدرية) + Cursor (المصفوفة الحية، المرحلة 10). القبول: مصفوفة RBAC الحية (أدناه) تمر 100%.

### P1-IMPORTER-SILENT-PATHS — مسارات صامتة متبقية في المستورد

- الدليل: تفضيل «الاسم المجرّد من اللقب» صامتًا عند الغموض (`...-source-resolver.ts:228-237`)؛ ربط ورقة↔فصل يدوي بلا تحقق (`import.tsx:580-636`)؛ استبعاد برامج غير جاهزة من «جميع الأقسام» بلا تحذير (`:447-473`)؛ تضخيم ساعات لكل delivery group (`:753-781`)؛ ابتلاع خطأ كشف نمط الملف (`import.tsx:246-248`)؛ `detectTeachingImportWorkbookMode` يسقط للقالب الرسمي عند الفشل (`schema:77`).
- المسؤول: Codex. الترتيب: مع P0-IMPORT-REAL-FILE (نفس PR أو PR متتالٍ).

### P1-APPLIED-STATE-UNKNOWN — كائنات runtime يستدعيها العميل قد لا تكون مطبَّقة

- الدليل: `transition_schedule_version`, `begin_schedule_quality_snapshot`, `persist_schedule_quality_run`, `commit_import_job_atomic`, `upsert_instructor_unavailability_for_active_days` كلها في ملفات موسومة SOURCE-ONLY/NOT APPLIED والعميل يستدعيها (`lifecycle.ts:197`, `scorer.ts:230,266`, `commit.ts:63`, `bulk-api.ts`). إن لم تُطبَّق يدويًا فهذه التدفقات معطّلة حيًا (PGRST202).
- المسؤول: Cursor (الخطوة الصفرية) ثم تطبيق مرتب. الترتيب: المرحلة 3-4. (إن ثبت التطبيق اليدوي: يُغلق ويُوثَّق في سجل الترحيلات.)

### P1-STALE-OPEN-PRS — 11 PR مفتوح قديم يهدد التوازي

- الدليل: قائمة A1؛ عدة PRs موسومة NOT APPLIED وتتقاطع مع P0-3/P1-LEGACY (#70, #73, #66, #69, #74).
- المسؤول: Cursor (قرار إغلاق/إحياء لكل PR) قبل بدء إصلاحات Codex. الترتيب: المرحلة 2.

---

## P2_DEFERRED

| ID | العنصر | الدليل | المسؤول |
|---|---|---|---|
| P2-UNSCHEDULED-REASONS | أسباب عدم الجدولة نص حر بلا أكواد مهيكلة | `greedy.ts:480-483,509` | Codex |
| P2-DEAD-CODE-TA-SERVICE | `commitTeachingAssignmentsV2Import` بلا مستدعٍ | `teaching-assignments-v2-service.ts:134-155` | Codex |
| P2-ARABIC-DIGITS | الأرقام العربية-الهندية والفاصلة العربية غير مدعومة في parse | `...-source-parser.ts:49,55-60` | Codex |
| P2-DB-LEFTOVERS | `_phase6_b64_stage` (RLS بلا سياسات) + UAT fixtures قد تكون بقايا إنتاجية | A6-25 | Cursor |
| P2-HARNESS-GAPS | عقود SQL ساكنة فقط؛ لا اختبارات تنفيذية للتراجع/الفشل الجزئي/greedy/readiness | A4/A5 | Codex |
| P2-SHA-CHURN | 10+ commits docs-only لتثبيت SHAs | git log | Cursor |
| P2-SEPARATION-OF-DUTIES | college_admin واحد ينفذ draft→published كاملة | A7-C3 | المستخدم (قرار سياسة) |

---

## SOURCE_AUDIT

(تفاصيل كاملة في أقسام IMPORT/READINESS/SCHEDULER/RBAC أدناه — الملخص:)

- البنية التحتية للتدفق الجديد (cohorts/curriculum/delivery_groups/TA V2/توليد المنهج والمجموعات) **نظيفة تمامًا** من legacy.
- التهجين قائم في سطح الجدولة: `section_id` يجري من TA → session → conflict partition → clone → تقرير التعارضات (انظر P1-LEGACY-SECTION-ID).
- المسارات المعزولة فعلاً: `/sections` (مخفي + كتابة محجوبة client-side)، تقارير legacy الموسومة، excel-import لكيانات legacy (محجوبة من commit)، `legacy-section-adapter.ts` (يرمي بلا سياسة صريحة).
- نمطان مصدريان متكرران يجب حظرهما في المراجعة: `data ?? []` بلا فحص `.error` (fail-open)، وقبول صامت للغموض.

---

## MIGRATION_AUDIT

### ملخص

- 111 ملفًا، لا طوابع مكررة، لكن **تكرار محتوى واسع بنمط توأم وصفي↔UUID** (انظر جدول التوائم في تقرير A6 الداخلي — أبرزها: 21 زوج `ss_*`، `20260715120000≡20260715050855`، `20260715130100≡20260715174141`، `20260715011643≡20260715012000`، `20260717035611≡20260717043000` (متطابق 100%)، `20260721180000≈20260724002012`).
- الأمن النظيف: كل الـ 107 دوال SECURITY DEFINER مثبَّتة search_path؛ صفر GRANT لـ anon/public؛ RLS على 63 جدولًا بسياسات على 62 (الاستثناء `_phase6_b64_stage` المؤقت)؛ عزل الكلية بثلاث طبقات (RLS + RPC + triggers).
- `reset_experimental_schedule_data` (`20260715130000`) **مدمّر** — يجب التحقق أنه لم يُسجَّل في الإنتاج إطلاقًا.

### مصفوفة migrations الحرجة (اختصار — التفاصيل الكاملة لدى Cursor في قسم الاستعلامات)

| Migration | الخطر | تحقق قراءة فقط مطلوب | معالجة آمنة | موافقة إنتاج |
|---|---|---|---|---|
| `20260724002012` ↔ `20260721180000` (headcount) | انجراف مفتاح إصدار | schema_migrations + to_regclass + pg_proc | repair بعد مطابقة | نعم |
| `20260717050000` (cross-college composite UNIQUE) | NOT APPLIED لكن headcount يفترضها | pg_constraint على cohorts/terms | تطبيق fail-closed | نعم |
| `20260717093000` (builder V2 + أحدث move RPC) | الإنتاج قد يشغّل RPC نقل قديم بلا حُرّاس V2 | md5(prosrc) مقارنة | CREATE OR REPLACE | نعم |
| `20260717035611` ≡ `20260717043000` (TA V2) | أيهما في السجل؟ | schema_migrations + pg_proc | repair | نعم |
| `20260718120000` (دورة الحياة الذرية) | غائب = P0-3 | pg_proc | تطبيق + REVOKE | نعم |
| `20260718210000` + `20260718180000` (atomic import commit/manifest) | العميل يستدعيها | pg_proc | تطبيق | نعم |
| `20260718183000` (cohort curriculum hardening) | الإنتاج على نسخة أضعف؟ | md5(prosrc) | تطبيق forward-only | نعم |
| `20260720120000` (availability bulk RPCs) | الواجهة تستدعيها | pg_proc | تطبيق | نعم |
| `20260720143000` (program/department integrity) | الإنتاج على FKs قديمة | pg_constraint confdeltype | تطبيق آمن (صفر برامج) | نعم |
| `20260721090000` (legacy write hardening) | تطبيقه المبكر يكسر مسارات قديمة؛ مشروط بـ A1.3b | pg_trigger + عدّ الأيتام | بعد A1.3b فقط | نعم (حرج) |
| `20260715130000` (reset experimental) | مدمّر | schema_migrations | يجب ألا يُطبَّق | حظر |
| `20260715200200/15200500/15200600` (course offering term orphans) | تعترف بـ 213 يتيمًا في الإنتاج | عدّ الأيتام + convalidated | معالجة A1-3B | نعم (حساس) |
| `20260709193500` (conflict exceptions) | بلا توأم UUID | to_regclass + schema_migrations | repair | نعم |

---

## IMPORT_AUDIT

(الأساس الكامل في A4 — أبرز النقاط:)

- المسار: `import.tsx` ← `teaching-assignments-source-import.ts` ← parser ← resolver ← `commit_import_job_atomic` (ذري، FOR UPDATE، idempotent replay، rollback كامل — **أقوى جانب**).
- عيوب حرجة مؤكدة: انظر P0-IMPORT-REAL-FILE (4 عيوب) وP1-IMPORTER-SILENT-PATHS (6 مسارات).
- سليم: تطبيع عربي شامل + honorifics (PR #96)، عزل الكلية/النظام الدراسي/الفصل/المستوى، منع التكرار بمفتاح طبيعي + فهرس فريد، حجب صريح لغياب delivery groups، أخطاء استعلامات السياق تُرمى ولا تُحسب صفرًا.
- فجوات اختبار: غموض المحاضر، نهاية-لنهاية مع رفض الخادم للساعات الفائضة، rollback تنفيذي، ورقة فصل ثانٍ حقيقية (الـ harness يربط الورقتين بنفس الفصل!)، التسميات الست.
- الملف الحقيقي غير موجود في المستودع (موثق `b002982d-….xlsx` خارجي).

---

## READINESS_AUDIT

(الأساس الكامل في A5:)

- الفحوص الموجودة: headcount معتمد (critical)، دفعات بلا مجموعات، delivery groups، إسناد V1+V2 (critical)، قاعات (نوع/سعة) (critical جزئيًا).
- الفحوص المفقودة: active study plan، cohort curriculum completeness، كفاية أنواع القاعات المطلوبة، time templates، instructor availability، room availability، constraint settings → P1-READINESS-COVERAGE-GAPS.
- Fail-open مؤكد → P0-READINESS-FAILOPEN.
- لا بُعد study_system في الجاهزية إطلاقًا.

---

## SCHEDULER_AUDIT

(الأساس الكامل في A5:)

- إنفاذ سعة/نوع القاعة مُنفَّذ فعليًا قبل الوضع (greedy pool filtering + validateProposed + SQL `_ss_cap`/`_ss_room_type`).
- تغطية التعارضات: محاضر/قاعة/شعبة مغطاة؛ **delivery_group/cohort غير مغطاة** في المحرك الرئيسي → P1-DELIVERY-GROUP-CONFLICT-GAP.
- ابتلاع أخطاء → P1-SCHEDULER-ERROR-SWALLOW؛ أسباب عدم الجدولة نصية → P2.
- دورة الحياة: آلة حالات عميلة سليمة، لكن الإنفاذ الخادمي غير مطبَّق → P0-PUBLISH-GATE-MISSING؛ لا توجد حالة `experimental` صريحة في `SVStatus`.
- العدد المعتمد لا يغذّي المجدول → P1-HEADCOUNT-NOT-CONSUMED؛ ثغرة `both` → P1-STUDY-SYSTEM-BOTH-BYPASS.

---

## RBAC_AUDIT

(الأساس الكامل في A7:)

- البنية سليمة: `app_role` enum + `user_roles`/`user_colleges` منفصلان، فحص مزدوج RLS+RPC، كل دوال الكتابة الممنوحة لـ authenticated تفحص الدور، الدوال الداخلية مقفلة على service_role، صفر منح anon.
- ثغرات مؤكدة: C1-C7 (انظر P1-RBAC-GAPS وP0-3 وP1-LEGACY).
- الفيصل: **الخطوة الصفرية** (حالة تطبيق الكائنات source-only) تحسم أي الثغرات نظرية وأيها فعلية.

---

## TEST_RESULTS

| الأمر | exit | النتيجة | ملاحظة |
|---|---|---|---|
| `bun install --frozen-lockfile` | 0 | 463 packages | فشل أولي بيئي (bun npm shim مكسور؛ استُخدم `~/.bun/bin` v1.3.14) — environment issue لا علاقة له بالمصدر |
| `git diff --check` | 0 | PASS | نظيف |
| `bunx tsc --noEmit` | 0 | PASS | — |
| `bun run build` | 0 | PASS | vite build ناجح |
| `bun test` | 0 | **4 pass / 0 fail** | مطابق للمبلَّغ |
| `bun run test:harness` | 0 | **48 passed / 0 failed / 0 missing** | مطابق للمبلَّغ |
| runtime-gates المكافئ المحلي | — | diff-check + scoped ESLint (vacuous — لا ملفات متغيرة) + tsc + build + harness | مطابق لخطوات `.github/workflows/runtime-gates.yml` |
| Scoped ESLint | — | vacuous PASS | لا ملفات متغيرة على worktree نظيف؛ سيُعاد على فرع K3 بعد إضافة التقارير |

- baseline failures: لا شيء. new failures: لا شيء. missing artifacts: لا شيء.
- الفشل البيئي الوحيد (bun shim) وُثّق وحُلّ دون أي تعديل مصدري.

---

## PRODUCTION_READONLY_QUERIES_FOR_CURSOR

كل ما يلي **قراءة فقط**. التنفيذ من Cursor فقط.

```sql
-- Q0: بصمة النشر الحي (خارج SQL): curl -sI https://gomufadhala.com | findstr /i "x-deployment-id"
-- Q1: سجل الترحيلات الكامل مقابل المصدر
select version, name from supabase_migrations.schema_migrations order by version;
-- Q2: التوائم والمفاتيح الحرجة
select version from supabase_migrations.schema_migrations where version in
 ('20260721180000','20260724002012','20260717035611','20260717043000','20260709193500',
  '20260715130000','20260717050000','20260718120000','20260718180000','20260718210000',
  '20260718183000','20260720120000','20260720143000','20260721090000','20260717093000','20260716233716');
-- Q3: وجود كائنات runtime الحرجة
select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in
 ('transition_schedule_version','begin_schedule_quality_snapshot','persist_schedule_quality_run',
  'commit_import_job_atomic','finalize_import_job','fail_import_job','claim_import_job_manifest',
  'create_import_preview_manifest','upsert_instructor_unavailability_for_active_days',
  'generate_cohort_curriculum','generate_cohort_delivery_groups',
  'move_or_reschedule_schedule_session','validate_schedule_session_move',
  'commit_teaching_assignments_v2_import','upsert_scheduling_cohort_term_headcount',
  'approve_capacity_split_proposal') order by 1;
-- Q4: مطابقة تعريفات الدوال الحرجة مع المصدر (قارن md5 بمحتوى الملفات)
select proname, md5(prosrc) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in
 ('move_or_reschedule_schedule_session','ensure_ss_college','ensure_ta_college','generate_cohort_curriculum');
-- Q5: الجداول الحرجة وبقايا الترحيل
select to_regclass('public.scheduling_cohort_term_headcounts'),
       to_regclass('public.delivery_groups'),
       to_regclass('public.schedule_version_conflict_exceptions'),
       to_regclass('public.section_subgroups'),
       to_regclass('public._phase6_b64_stage'),
       to_regclass('public.v_instructor_delivery_workload');
-- Q6: قيود cross-college المركبة (متطلب headcount)
select conname, conrelid::regclass from pg_constraint
 where conrelid in ('public.academic_cohorts'::regclass,'public.academic_terms'::regclass) and contype='u';
-- Q7: أيتام course_offerings (اعتراف 213)
select count(*) as orphan_term_ids from public.course_offerings co
 left join public.academic_terms t on t.id=co.term_id where t.id is null;
-- Q8: triggers الحظر والسلامة
select tgname, tgrelid::regclass from pg_trigger
 where tgname in ('legacy_write_block','trg_rooms_delete_integrity') or tgname like 'ensure_%';
-- Q9: أرقام الكتابات المزعومة
select (select count(*) from public.study_plans) as study_plans,
       (select count(*) from public.plan_courses) as plan_courses,
       (select count(*) from public.plan_course_components) as components,
       (select count(*) from public.academic_cohorts) as cohorts,
       (select count(*) from public.delivery_groups) as delivery_groups,
       (select count(*) from public.teaching_assignments) as teaching_assignments,
       (select count(*) from public.schedule_versions) as schedule_versions,
       (select count(*) from public.schedule_sessions) as schedule_sessions;
-- Q10: أدوار وجلسات
select r.role, count(*) from public.user_roles r group by 1;
select count(*) from public.user_colleges;
-- Q11: منح الجداول الحساسة
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_name in ('import_jobs','sections','schedule_versions','user_roles','user_colleges','audit_logs')
   and grantee in ('authenticated','anon') order by 2,1,3;
-- Q12: FKs برامج/أقسام
select conname, confdeltype from pg_constraint
 where conname in ('academic_programs_college_id_fkey','academic_programs_department_id_fkey');
```

---

## FINAL_EXECUTION_PLAN

المراحل مرتبة؛ لا تبدأ مرحلة قبل إغلاق اعتمادياتها؛ لكل مرحلة مالك واحد.

| # | المرحلة | المالك | يغلق | الاعتماد |
|---|---|---|---|---|
| 1 | **Source truth freeze**: تثبيت main الحالي (`62245a3`) كأساس؛ منع PRs جديدة خارج الخطة | Cursor | — | — |
| 2 | **PR reconciliation**: قرار إغلاق/إحياء لكل PR من الـ 11 المفتوحة؛ خصوصًا #70/#73/#66 (تتقاطع مع P0-3/P1-LEGACY) — لا PRs متوازية على نفس الملفات | Cursor | P1-STALE-OPEN-PRS | 1 |
| 3 | **Read-only production inventory**: تنفيذ Q0-Q12 أعلاه + توثيق النتائج | Cursor | جزء من P0-MIGRATION-DRIFT | 1 |
| 4 | **Migration/history reconciliation**: repair للمفاتيح + تطبيق migrations المعلقة بموافقة إنتاج (`20260718120000`, `20260718210000`, `20260718180000`, `20260717050000`, `20260717093000`, `20260718183000`, `20260720120000`, `20260720143000` بترتيب التبعية) — preflight قبل كل تطبيق | Cursor | P0-MIGRATION-DRIFT, P0-PUBLISH-GATE-MISSING, P1-APPLIED-STATE-UNKNOWN | 2,3 |
| 5 | **Main deployment**: تأكيد مسار النشر (Lovable أو بديل) + نشر build واحد يتضمن ما دُمج حتى الآن + تحقق البصمة | Cursor | P0-LIVE-DEPLOY-STALE | 4 |
| 6 | **Academic catalog closure**: إغلاق فجوات المنهج/المستوى/الفصل التي أنتجت 164 course_not_found (قراءة Q9 + معالجة بيانات بموافقة) | Cursor | جزء من P0-IMPORT-REAL-FILE (جانب البيانات) | 3,5 |
| 7 | **Teaching assignments import**: Codex يسلّم إصلاحات P0-IMPORT-REAL-FILE + P1-IMPORTER-SILENT-PATHS في PR واحد مترابط → دمج → معاينة حية → التزام ذري → إعادة تشغيل idempotency | Codex (مصدر) → Cursor (حي) | P0-IMPORT-REAL-FILE, P1-IMPORTER-SILENT-PATHS | 5,6 |
| 8 | **Readiness closure**: Codex يسلّم P0-READINESS-FAILOPEN + P1-READINESS-COVERAGE-GAPS → دمج → تحقق حي أن كل فحص حقيقي وأن الفشل يعطّل | Codex → Cursor | P0-READINESS-FAILOPEN, P1-READINESS-COVERAGE-GAPS | 7 |
| 9 | **Experimental schedule E2E**: Codex يسلّم P1-SCHEDULER-ERROR-SWALLOW + P1-DELIVERY-GROUP-CONFLICT-GAP + P1-STUDY-SYSTEM-BOTH-BYPASS + P1-HEADCOUNT-NOT-CONSUMED → نسخة تجريبية → جدولة → صفر تعارضات غير معتمدة → تقرير جودة — **لا نشر رسمي هنا** | Codex → Cursor | P1×4 | 8 |
| 10 | **RBAC/RLS live matrix**: تنفيذ المصفوفة الكاملة (أدناه) بخمسة سياقات (SA/CA-A/CA-B/RO-A/ANON) | Cursor | P1-RBAC-GAPS (التحقق) | 9 |
| 11 | **Reports/export/responsive smoke**: تقارير + تصدير + تجاوب على النسخة التجريبية | Cursor | — | 9 |
| 12 | **Backup/rollback verification**: لقطة/نسخة احتياطية موثقة + تمرين استرجاع جزئي قبل أي نشر رسمي | Cursor | — | 4 |
| 13 | **Release candidate**: build واحد أخير يجمع كل الإصلاحات المدموجة + تشغيل كل البوابات + تجميد | Cursor | — | 5-12 |
| 14 | **Launch decision**: قرار المستخدم بناءً على هذا التقرير بعد إغلاق P0×5 وP1×9 | المستخدم | — | 13 |
| 15 | **Post-launch monitoring**: error capture + مراقبة تعارضات/جودة + خطة rollback جاهزة | Cursor | — | 14 |

---

## PHASE_GATES

| المرحلة | بوابة القبول | Rollback |
|---|---|---|
| 3 | كل استعلام موثق بنتيجته؛ صفر أسئلة UNKNOWN حرجة | — (قراءة فقط) |
| 4 | md5 الدوال الحرجة مطابق؛ schema_migrations مفسَّر 100% | repair عكسي / إسقاط كائنات مطبَّقة حديثًا |
| 5 | بصمة النشر تطابق الـ build | إعادة النشر السابق |
| 6 | إعادة المعاينة: course_not_found=0 | البيانات الأكاديمية upsert قابلة للعكس |
| 7 | READY≥95%، التزام ناجح، إعادة تشغيل=unchanged | ذرية الالتزام + حذف import_job |
| 8 | فصل الشبكة/خطأ RLS = تعطيل التشغيل برسالة | revert |
| 9 | نسخة تجريبية بصفر تعارضات غير معتمدة + جودة مسجلة | حذف النسخة التجريبية |
| 10 | كل حالات المصفوفة بالنتيجة المتوقعة (بما فيها 42501) | تصحيح الأدوار الممنوحة للاختبار |
| 12 | استرجاع تجريبي ناجح موثق | — |
| 13 | كل البوابات خضراء على SHA مرشح مثبت | عدم النشر |

---

## ROLLBACK_MATRIX

| الإجراء | آلية التراجع | الخطر المتبقي |
|---|---|---|
| تطبيق migration جديدة | ملف rollback لكل migration (DROP/إعادة تعريف) — يُجهَّز قبل التطبيق | منخفض إن كان CREATE OR REPLACE |
| migration repair | إزالة صف السجل فقط — لا أثر مخططي | لا شيء |
| التزام استيراد TA | ذري بطبيعته؛ إعادة التشغيل idempotent؛ حذف الإسنادات بمفتاح import_job | منخفض |
| نشر build | إعادة نشر النسخة السابقة | فجوة زمنية فقط |
| نشر جدول رسمي | أرشفة النسخة (لا حذف) + إبقاء السابقة | منخفض |
| إصلاحات Codex المصدرية | revert per-commit | لا شيء (PRs مستقلة) |

---

## OWNERSHIP_MATRIX

| المكون | المالك الوحيد | ممنوع على |
|---|---|---|
| الدمج والنشر والكتابات الإنتاجية والاختبار الحي | **Cursor** | Codex، K3 |
| إصلاحات المصدر (import/readiness/scheduler/RBAC) + regression tests | **Codex** | أي كتابة إنتاجية |
| هذا التقرير + التحقق المستقل اللاحق | **K3** | الدمج، النشر، الإنتاج |
| قرار الإطلاق + قرارات السياسة (separation of duties، مصير تقسيم السعة، Lovable) | **المستخدم** | — |

قواعد عدم التداخل: لا PRs متوازية تعدّل نفس الملفات (يُتحقق قبل فتح أي PR)؛ build واحد لكل مجموعة إصلاح مترابطة؛ لا نشر جدول رسمي قبل نجاح مرحلتَي 9 و10؛ لا افتراض لبيانات أكاديمية غير مثبتة باستعلام.

---

## مصفوفة الاختبار الحي لـ RBAC (المرحلة 10 — تنفيذ Cursor)

**الخطوة الصفرية**: Q3+Q11 أعلاه — تحسم أي فرع من التوقعات. الحسابات: SA، CA-A، CA-B، RO-A، ANON.

### super_admin — إيجابي
| # | الإجراء | المتوقع |
|---|---|---|
| SA-1 | `select * from colleges` | كل الكليات |
| SA-2 | `insert into user_roles values ('<uid>','read_only')` | نجاح |
| SA-3 | `rpc transition_schedule_version {p_college_id:<cA>, p_schedule_version_id:<verA>, p_to_status:'review'}` | نجاح (PGRST202 = P0-3 قائم) |
| SA-4 | server fn `adminCreateUser` | نجاح + صف audit_logs |
| SA-5 | `rpc create_teaching_assignment_v2 {...}` على dg في A | نجاح |

### college_admin — كليته (إيجابي)
| # | الإجراء | المتوقع |
|---|---|---|
| CA-1 | `insert into departments (college_id:<cA>,...)` | نجاح |
| CA-2 | `rpc move_or_reschedule_schedule_session` على جلسة A | ok أو تعارضات — ليس FORBIDDEN |
| CA-3 | `rpc create_import_preview_manifest {p_college_id:<cA>,...}` | نجاح |
| CA-4 | `rpc upsert_scheduling_cohort_term_headcount` على cohort A | ok:true |
| CA-5 | `rpc commit_import_job_atomic` لمهمة preview في A | نجاح (PGRST202 = P1-APPLIED-STATE قائم) |

### college_admin — كلية أخرى (سلبي، جلسة CA-A تستهدف B)
| # | الإجراء | المتوقع |
|---|---|---|
| XX-1 | `select * from departments where college_id=<cB>` | 0 صفوف |
| XX-2 | `insert into departments (college_id:<cB>,...)` | 42501 |
| XX-3 | `rpc transition_schedule_version` على نسخة B | 42501 `SCHEDULE_VERSION_TRANSITION_FORBIDDEN` |
| XX-4 | `rpc move_or_reschedule_schedule_session` على جلسة B | jsonb `FORBIDDEN_COLLEGE` |
| XX-5 | `rpc create_import_preview_manifest {p_college_id:<cB>,...}` | 42501 |
| XX-6 | `rpc create_teaching_assignment_v2` على dg في B | 42501 |
| XX-7 | `rpc upsert_instructor_unavailability_for_active_days` على محاضر B | 42501 |
| XX-8 | `rpc upsert_scheduling_cohort_term_headcount` على cohort B | jsonb `FORBIDDEN` |
| XX-9 | `update schedule_versions set status='published'` لنسخة B | 42501 / 0 rows |
| XX-10 | `insert into schedule_sessions (college_id:A, room_id: من B,...)` | يجب أن يفشل؛ نجاحه = تسرب مرجعي مؤكد (P2-cross-ref) |

### read_only (RO-A)
| # | الإجراء | المتوقع |
|---|---|---|
| RO-1 | قراءة جداول كليته | صفوف مرئية |
| RO-2 | `rpc list_teaching_assignment_workspace` | نجاح مع `can_manage:false` |
| RO-3 | واجهة: `/departments` `/rooms` `/schedule-builder` | أزرار الكتابة مخفية/معطلة |
| RO-4 | `insert into departments (college_id:<cA>,...)` | 42501 |
| RO-5 | `update rooms set capacity=99 ...` | 42501 |
| RO-6 | `rpc move_or_reschedule_schedule_session` على جلسة A | jsonb `FORBIDDEN_COLLEGE` |
| RO-7 | `rpc create_import_preview_manifest` | 42501 |
| RO-8 | `rpc transition_schedule_version` | 42501 |
| RO-9 | `rpc create_teaching_assignment_v2` | 42501 |
| RO-10 | تصعيد: `insert into user_roles values (auth.uid(),'college_admin')` | 42501 |
| RO-11 | تصعيد: `insert into user_colleges values (auth.uid(),<cB>)` | 42501 |
| RO-12 | `insert into import_jobs ...` مباشرة | 42501 (إن طُبِّق عقد manifest؛ نجاحه = فجوة) |
| RO-13 | `insert into sections ...` | اليوم: 42501 لـ RO / نجاح لـ CA؛ بعد `20260721090000`: 42501 للجميع |
| RO-14 | `insert into audit_logs (actor_id=auth.uid(),...)` | نجاح (سلوك معروف C7) |

### anonymous
| # | الإجراء | المتوقع |
|---|---|---|
| AN-1 | `select colleges` بمفتاح anon | 0 صفوف / 401 |
| AN-2 | `rpc transition_schedule_version` | 42501 `AUTHENTICATION_REQUIRED` |
| AN-3 | `rpc create_import_preview_manifest` | 28000 |
| AN-4 | `rpc move_or_reschedule_schedule_session` | رفض |
| AN-5 | `rpc is_super_admin('<uuid>')` | 42501 |

### فحوص بنيوية
- ST-2: إنشاء حساب signup عام → يجب ألا يرى أي بيانات كلية.
- ST-3: CA-A ينفّذ `commit_teaching_assignments_v2_import` بحمولة تخلط A+B → فشل ذري كامل بلا تطبيق جزئي.
- ST-1 (C4): **مراجعة كود فقط — لا تنفيذ على الإنتاج.**

---

## FINAL_DECISION

**HOLD_WITH_ONE_EXACT_AUDIT_BLOCKER**

المانع الدقيق الواحد: **لا يمكن بدء تنفيذ الإطلاق قبل إغلاق P0-IMPORT-REAL-FILE — مستورد الإسناد غير قادر على استيراد ملف الإسناد الحقيقي (READY=0 موثق + ثلاثة عيوب مصدرية مؤكدة تجعل الفشل شاملًا حتى بعد إصلاح aliases)، وهو الاعتماد الأول لكل ما يليه (readiness → جدولة → نشر).**

كل العناصر الأخرى مسارها واضح ومالكها محدد في FINAL_EXECUTION_PLAN، لكنها لا تغيّر أن الاستيراد هو حجر الأساس الذي لا جدولة ولا إطلاق بدونه.
