# PLATFORM-LAUNCH-CHECKLIST

Checklist تنفيذية لـ Cursor (Release Lead) — مرحلة بمرحلة، مبنية على `PLATFORM-LAUNCH-GAP-AUDIT-K3-01.md`.
القواعد الثابتة: لا تبدأ مرحلة قبل اكتمال ✔ مرحلتها المعتمدة · كل كتابة إنتاجية يسبقها preflight · build واحد لكل مجموعة إصلاح مترابطة · لا نشر جدول رسمي قبل المرحلتين 9 و10 · لا افتراض لبيانات غير مثبتة باستعلام.

الأساس المثبت: `ORIGIN_MAIN_SHA = 62245a3bf4f49091177d6248c3bc8e05ddbfb90d`

---

## المرحلة 1 — Source truth freeze

- [ ] تأكيد أن main المحلي والبعيد على `62245a3…` (أو تثبيت أساس جديد موثق إن تقدّم main)
- [ ] إعلان تجميد: لا PRs جديدة خارج خطة الإطلاق
- [ ] إغلاق/أرشفة مؤقت لأي عمل متوازٍ يمس ملفات الخطة

## المرحلة 2 — PR reconciliation

- [ ] قرار موثق لكل PR مفتوح (87, 84, 78, 77, 75, 74, 73, 70, 69, 66, 30): إغلاق أو إحياء بترتيب
- [ ] تحديدًا: #70 و#73 و#66 (تتقاطع مع دورة الحياة وlegacy hardening) — يُحسم ترتيبها قبل المرحلة 4
- [ ] التحقق أنه لا يوجد PRان مفتوحان يعدّلان الملفات نفسها

## المرحلة 3 — Read-only production inventory (قراءة فقط)

- [ ] تنفيذ Q0: بصمة النشر الحي `curl -sI https://gomufadhala.com` وتوثيق `x-deployment-id`
- [ ] تنفيذ Q1-Q12 (في التقرير الرئيسي، قسم PRODUCTION_READONLY_QUERIES_FOR_CURSOR) وتوثيق كل نتيجة
- [ ] حسم: هل `20260715130000` (reset المدمّر) مسجَّل في schema_migrations؟ (إن نعم → تصعيد فوري للمستخدم)
- [ ] حسم الخطوة الصفرية لـ RBAC: أي كائنات source-only مطبَّقة فعلاً (Q3)
- [ ] مخرج المرحلة: مصفوفة applied vs source موقعة بالتاريخ

## المرحلة 4 — Migration/history reconciliation (موافقة إنتاج مطلوبة)

- [ ] preflight قبل كل خطوة (عدّادات القيود/الأيتام من المرحلة 3)
- [ ] `supabase migration repair` للمفاتيح الناقصة بعد مطابقة md5 (Q4) — لا تغيير مخططي
- [ ] تطبيق مرتب بموافقة: `20260717050000` ← `20260717093000` ← `20260718120000` (دورة الحياة) ← `20260718180000` ← `20260718210000` ← `20260718183000` ← `20260720120000` ← `20260720143000`
- [ ] تأجيل صريح: `20260721090000` (legacy write hardening) حتى معالجة أيتام A1.3b
- [ ] حظر دائم: عدم تطبيق `20260715130000` على الإنتاج إطلاقًا
- [ ] تحقق بعدي: md5 الدوال الحرجة مطابق لأحدث مصدر مقصود
- [ ] Rollback جاهز لكل تطبيق قبل تنفيذه

## المرحلة 5 — Main deployment

- [ ] حسم مسار النشر: Lovable Publish أو بديل موثق (مع المستخدم)
- [ ] نشر build واحد من main المثبت
- [ ] تحقق البصمة: `x-deployment-id` يطابق + علامات الإصدار ظاهرة في الأصول
- [ ] Rollback: إعادة النشر السابق موثقة الخطوات

## المرحلة 6 — Academic catalog closure

- [ ] مطابقة نتائج Q9 مع المزعوم (4 خطط/16 مستوى/144 صف/308 مكوّنات/64 دفعة/181 dg)
- [ ] تشخيص الـ 164 `course_not_found`: خطة/مستوى/فصل — قائمة بيانات ناقصة محددة
- [ ] إغلاق البيانات الناقصة (upsert بموافقة إنتاج) ثم إعادة قياس

## المرحلة 7 — Teaching assignments import

- [ ] استلام PR Codex (إصلاحات: program carry-forward، aliases الست، expand_all hours، رؤية الاستبعاد الصامت، المسارات الصامتة) + regression tests + بوابات خضراء
- [ ] دمج PR Codex (Cursor فقط)
- [ ] معاينة حية على الملف الحقيقي: توثيق READY/BLOCKED/AMBIGUOUS
- [ ] بوابة: READY ≥ 95% وكل BLOCKED مفسَّر
- [ ] الالتزام الذري + إعادة تشغيل فورية (يجب: unchanged — idempotent)
- [ ] توثيق import_job النهائي

## المرحلة 8 — Readiness closure

- [ ] استلام PR Codex (fail-closed + الفحوص السبعة المفقودة) ودمجه
- [ ] تحقق حي: فصل الشبكة/خطأ RLS = تعطيل زر الجدولة برسالة واضحة
- [ ] تحقق حي: كلية فارغة ≠ «جاهز»
- [ ] لوحة `/data-readiness` تعرض صفر موانع حرجة غير مفسَّرة

## المرحلة 9 — Experimental schedule E2E (لا نشر رسمي)

- [ ] استلام PR Codex (error swallowing + delivery-group conflict + both bypass + headcount consumption) ودمجه
- [ ] إنشاء نسخة جدول **تجريبية** → تشغيل auto-schedule → توثيق run
- [ ] فحص التعارضات: صفر تعارضات غير معتمدة (أو كل استثناء موثق باعتماد)
- [ ] تشغيل تقرير الجودة وتوثيقه
- [ ] مراجعة أسباب unscheduled: كل سبب دقيق وقابل للعرض
- [ ] Rollback: حذف النسخة التجريبية

## المرحلة 10 — RBAC/RLS live matrix

- [ ] تجهيز السياقات الخمسة: SA، CA-A، CA-B، RO-A، ANON
- [ ] تنفيذ المصفوفة كاملة (SA-1..5, CA-1..5, XX-1..10, RO-1..14, AN-1..5, ST-2, ST-3) — في التقرير الرئيسي
- [ ] كل حالة بنتيجتها المتوقعة (بما فيها 42501/jsonb FORBIDDEN)
- [ ] ST-1 (bootstrap): مراجعة كود فقط — ممنوع التنفيذ على الإنتاج
- [ ] أي انحراف = إيقاف وتصعيد قبل المتابعة

## المرحلة 11 — Reports/export/responsive smoke

- [ ] التقارير التشغيلية والمنشورة على النسخة التجريبية
- [ ] التصدير (admin-export) ينتج ملفات صحيحة
- [ ] فحص تجاوب سريع (mobile/desktop) للأسطح الرئيسية

## المرحلة 12 — Backup/rollback verification

- [ ] نسخة احتياطية/لقطة موثقة قبل أي نشر رسمي
- [ ] تمرين استرجاع جزئي ناجح وموثق

## المرحلة 13 — Release candidate

- [ ] build واحد أخير يجمع كل الإصلاحات المدموجة
- [ ] كل البوابات خضراء على SHA المرشح (diff-check, tsc, build, bun test, harness, runtime-gates)
- [ ] تجميد موثق للـ SHA المرشح

## المرحلة 14 — Launch decision

- [ ] عرض على المستخدم: حالة P0×5 وP1×9 مغلقة بدليل + نتائج المراحل 9-12
- [ ] قرار المستخدم: إطلاق / تأجيل مسبب
- [ ] عند الإطلاق فقط: نشر الجدول الرسمي عبر `transition_schedule_version` (لا UPDATE مباشر أبدًا)

## المرحلة 15 — Post-launch monitoring

- [ ] مراقبة error capture والتعارضات والجودة أول 72 ساعة
- [ ] خطة rollback جاهزة ومعلنة
- [ ] تقرير إغلاق نهائي

---

### حالة عناصر التدقيق (للتعليم عند الإغلاق)

- [ ] P0-IMPORT-REAL-FILE
- [ ] P0-READINESS-FAILOPEN
- [ ] P0-PUBLISH-GATE-MISSING
- [ ] P0-LIVE-DEPLOY-STALE
- [ ] P0-MIGRATION-DRIFT-UNVERIFIED
- [ ] P1-SCHEDULER-ERROR-SWALLOW
- [ ] P1-DELIVERY-GROUP-CONFLICT-GAP
- [ ] P1-LEGACY-SECTION-ID
- [ ] P1-STUDY-SYSTEM-BOTH-BYPASS
- [ ] P1-HEADCOUNT-NOT-CONSUMED
- [ ] P1-READINESS-COVERAGE-GAPS
- [ ] P1-RBAC-GAPS
- [ ] P1-IMPORTER-SILENT-PATHS
- [ ] P1-APPLIED-STATE-UNKNOWN
- [ ] P1-STALE-OPEN-PRS
