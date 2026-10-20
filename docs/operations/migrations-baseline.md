# خط الأساس للترحيلات وإجراء الدمج (M-7)

## المشكلة

سجل `supabase/migrations/` (أكثر من 340 ملفًا) لا يعيد بناء قاعدة الإنتاج من الصفر: عند إعادة
التشغيل على قاعدة جديدة يفشل نحو 88 ملفًا تاريخيًا (`scripts/db/replay-known-failures.txt`) لأنها
كُتبت لمشروع حي (بيانات مفترضة، أدوار غير موجودة، كائنات أُنشئت في SQL Editor أو بملفات
`docs/migrations-proposed/`). لذلك لا يوجد اليوم مصدر موثوق واحد يقول "هذا هو مخطط الإنتاج".

## الأداة

`scripts/db/make-baseline.sh`:

| الأمر | ماذا يفعل | يحتاج |
| --- | --- | --- |
| `dump` | `pg_dump --schema-only` لمخططات التطبيق من الإنتاج → `supabase/reference/prod-schema-<date>.sql` (بلا بيانات) | `PROD_DB_READONLY_URL` (دور قراءة فقط) أو Supabase CLI مربوط |
| `replay` | يعيد بناء المخطط من المستودع (`scripts/db/replay-migrations.sh baseline_replay`) ويفرغه | PostgreSQL محلي مؤقت (`PGHOST`…) |
| `diff` | يطبّع الملفين (يحذف التعليقات وSET والمالكين، ويرتب العبارات) ويكتب `schema-diff-<date>.txt`؛ يخرج 1 عند وجود فرق | الملفان |
| `all` | الثلاثة بالترتيب | الكل |

جُرّبت الأداة محليًا (قاعدتان مُعاد بناؤهما بطريقتين مختلفتين) وأظهر `diff` الفرق الحقيقي بينهما
(جدول `provisioning_private.account_provisioning_grants` الذي يحتاج `search_path = public, extensions`).
لم يُؤخذ تفريغ من الإنتاج بعد — يحتاج وصولًا لا يتوفر في بيئة التطوير.

## إجراء الدمج (squash) — يدوي وبموافقة

لا تُعدَّل ولا تُحذف أي ترحيلة موجودة. الدمج يضيف خط أساس جديدًا فقط:

1. **تفريغ**: `scripts/db/make-baseline.sh dump` بدور قراءة فقط. راجع الملف (لا أسرار، لا بيانات)
   وأضفه في PR: `supabase/reference/prod-schema-<date>.sql`.
2. **فرق**: `scripts/db/make-baseline.sh replay && scripts/db/make-baseline.sh diff`. صنّف كل فرق:
   - موجود في الإنتاج وغائب عن المستودع → ترحيلة جديدة تلتقطه (أو قرار بإزالته من الإنتاج).
   - موجود في المستودع وغائب عن الإنتاج → ترحيلة لم تُطبق (يظهر أيضًا في `migration-drift`).
   - فروق ترتيب/تنسيق → حسّن التطبيع في السكربت.
3. **تقارب**: كرر حتى يصبح `diff` فارغًا (أو كل فرق موثق ومقبول في هذا الملف).
4. **خط الأساس**: أنشئ `supabase/migrations/<ts>_baseline.sql` = التفريغ المعتمد، مع حارس في أوله:
   ```sql
   -- يطبق فقط على قاعدة فارغة؛ قواعد موجودة تسجل الإصدار دون تنفيذ.
   do $$ begin
     if to_regclass('public.colleges') is not null then
       raise exception 'BASELINE_ON_EXISTING_DB';
     end if;
   end $$;
   ```
   وسجّل الإصدار في الإنتاج **بدون تنفيذ** (`insert into supabase_migrations.schema_migrations …`
   وفق `release-runbook.md`).
5. **أرشفة**: انقل الملفات الأقدم من خط الأساس إلى `supabase/migrations-archive/` في PR منفصل
   فقط بعد أن يمر `pr-gate` و`db-tests` باستخدام خط الأساس وحده؛ حدّث `scripts/db/replay-order.txt`
   ليبدأ بخط الأساس. سجل الإنتاج يبقى كما هو.
6. **تحقق نهائي**: `migration-drift` أخضر، و`replay-known-failures.txt` فارغ.

## متى

بعد إغلاق ترحيلات المسارات الأمنية الحالية (≥ `20261020000000`) وقبل أي ترحيلة كبيرة لاحقة.
