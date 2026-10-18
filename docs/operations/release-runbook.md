# دليل الإصدار إلى الإنتاج (M-24)

ينطبق على كل إصدار يصل إلى مستخدمي المنصة. الهدف: أن يكون معروفًا **من** ينشر، **أي commit** يُنشر،
وأن تُطبَّق الترحيلات بالترتيب وتُتحقق، وأن يوجد طريق رجوع موثّق.

- الواجهة والخادم (TanStack Start على Cloudflare) تُنشر عبر **Lovable → Publish**.
- قاعدة البيانات (Supabase) تُحدَّث **منفصلة** بالترحيلات في `supabase/migrations/`.
- مرجع مشروع الإنتاج هو `project_id` في `supabase/config.toml` (لا يُكتب في السكربتات؛ اقرأه من هناك).
- لا تُستخدم سكربتات `scripts/staging/*` للإنتاج أبدًا؛ `deploy-preflight.mjs` يرفض مرجع الإنتاج.

## الأدوار

| الدور | المسؤولية |
| --- | --- |
| مالك الإصدار (Release owner) | يختار الـ commit، يملأ سجل الإصدار، يقرر المتابعة/الإيقاف |
| مسؤول قاعدة البيانات | يطبق الترحيلات ويشغّل استعلامات التحقق (حساب Supabase بصلاحية Owner/Admin) |
| الناشر في Lovable | عضو مشروع Lovable بصلاحية Publish؛ ينشر نفس الـ commit فقط |
| مراجع ثانٍ | يراجع قائمة الترحيلات وملفات rollback قبل التطبيق (قاعدة الأربع عيون) |

لا يجمع شخص واحد بين تطبيق ترحيلة لم يراجعها أحد ونشرها.

## 0. شروط الدخول

1. الـ PR مدموج في `main` وفحوص **`pr-gate`** كلها خضراء على **نفس** الـ commit
   (`static`, `unit`, `pglite`, `db-tests`). يجب ضبط هذه الفحوص كـ *Required status checks* لفرع
   `main` في GitHub → Settings → Branches (إعداد في GitHub، لا يمكن فرضه من المستودع).
2. `migration-drift` آخر تشغيل أخضر (أو شغّله يدويًا: Actions → migration-drift → Run workflow).
3. كل ترحيلة جديدة لها `supabase/rollbacks/<الاسم>.down.sql` (يفحصه `pr-gate`).
4. نسخة احتياطية حديثة مؤكدة في لوحة Supabase (Database → Backups) ونقطة PITR مسجلة إن كانت مفعّلة
   (انظر `supabase-backup-restore.md`).
5. نافذة صيانة معلنة إن كانت أي ترحيلة تقفل جداول كبيرة.

## 1. تحديد الـ commit وقائمة الترحيلات

```bash
git fetch origin && git checkout --detach origin/main
RELEASE_SHA=$(git rev-parse HEAD); echo "$RELEASE_SHA"
# الترحيلات غير المطبقة على الإنتاج (اتصال قراءة فقط):
PROD_DB_READONLY_URL='postgresql://readonly…' scripts/db/migration-drift.sh
```

انسخ إلى سجل الإصدار (`docs/operations/releases/<YYYY-MM-DD>.md` أو تذكرة الإصدار): `RELEASE_SHA`،
قائمة `missing_in_db` بالترتيب، وأسماء ملفات rollback المقابلة. إن ظهر `unknown_in_repo` **توقف**
(انظر § الانحراف).

## 2. تطبيق الترحيلات بالترتيب

الترتيب = ترتيب أسماء الملفات (الطابع الزمني). طبّق ملفًا واحدًا في كل مرة، وتحقق قبل التالي.

### الخيار أ — Supabase CLI (مفضل)

```bash
supabase login
supabase link --project-ref "$(sed -n 's/^project_id *= *"\(.*\)"/\1/p' supabase/config.toml)"
supabase migration list            # تأكد أن القائمة "Local only" = قائمة الخطوة 1 فقط
supabase db push --dry-run         # راجع الملفات التي ستُطبق
supabase db push                   # بدون --include-all
```

- **لا تستخدم `--include-all`**: يطبق ترحيلات أقدم من آخر ترحيلة مطبقة بصمت، وهذا ما تسبب سابقًا في
  حالات انحراف.
- إن أظهر `migration list` ملفات قديمة "Local only" غير متوقعة فهذا انحراف تاريخي معروف (ملفات
  `docs/migrations-proposed` وغيرها)؛ لا تدفعها — راجع § الانحراف.

### الخيار ب — SQL Editor في لوحة Supabase

لكل ملف بالترتيب:

1. افتح الملف من الـ commit `RELEASE_SHA` (لا من نسخة محلية معدلة).
2. الصق المحتوى كاملًا في SQL Editor ونفّذه. الملفات مكتوبة لتكون قابلة لإعادة التشغيل
   (`CREATE OR REPLACE` / `IF NOT EXISTS`) لكن لا تعتمد على ذلك.
3. سجّل الإصدار في سجل الترحيلات حتى يبقى `migration-drift` متطابقًا:
   ```sql
   insert into supabase_migrations.schema_migrations (version, name)
   values ('<14 رقمًا من اسم الملف>', '<بقية الاسم بدون .sql>')
   on conflict (version) do nothing;
   ```
   (هذا السطر يُنفّذ يدويًا من مسؤول قاعدة البيانات فقط ضمن هذا الدليل؛ لا يوجد سكربت يفعل ذلك.)

## 3. استعلامات التحقق بعد كل ترحيلة

```sql
-- 1) السجل يطابق المستودع
select version, name from supabase_migrations.schema_migrations order by version desc limit 5;

-- 2) لا توجد دوال SECURITY DEFINER بدون search_path ثابت
select p.oid::regprocedure
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef and n.nspname = 'public'
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%');

-- 3) كل جداول public تحت RLS
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- 4) لا تعريض للدور anon على الدوال الجديدة
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')
  and p.prosecdef;
```

المتوقع: (2) و(3) و(4) بلا صفوف جديدة مقارنة بالإصدار السابق (احفظ النتيجة السابقة في سجل الإصدار).
إضافة إلى ذلك نفّذ استعلامات التحقق المذكورة في وصف الـ PR لكل ترحيلة.

## 4. النشر عبر Lovable

1. في Lovable تأكد أن المشروع متزامن مع GitHub وأن آخر commit ظاهر = `RELEASE_SHA`
   (إن كان Lovable متقدمًا بتعديلات غير مدموجة: **توقف** — يجب أن تمر عبر PR و`pr-gate` أولًا).
2. اضغط **Publish**. سجّل وقت النشر ومعرّف النشر (`x-deployment-id` في ترويسات الاستجابة).
3. تحقق دخانيًا (قراءة فقط): تسجيل الدخول، `/reports`، فتح جدول منشور لكلية، طباعة PDF واحد.
4. المتصفح: لا أخطاء في Console على الصفحات الثلاث أعلاه.

## 5. الرجوع (Rollback)

| المشكلة | الإجراء |
| --- | --- |
| خلل في الواجهة/الخادم فقط | Lovable → History → اختر النشر السابق → Restore/Publish. لا حاجة لتغيير قاعدة البيانات إذا كانت الترحيلات متوافقة للخلف. |
| خلل في ترحيلة | نفّذ `supabase/rollbacks/<الاسم>.down.sql` في SQL Editor، ثم احذف سطرها من السجل: `delete from supabase_migrations.schema_migrations where version = '<v>';` (بموافقة مراجع ثانٍ)، ثم أعد نشر الواجهة السابقة إن كانت تعتمد على الترحيلة. |
| تلف بيانات | أوقف الكتابة (وضع صيانة)، واستعد من Backups/PITR وفق `supabase-backup-restore.md`؛ القرار لمالك الإصدار. |

قاعدة: ترحيلات الإصدار تُرجع بالترتيب **العكسي**. لا تعدّل ملف ترحيلة مطبقًا؛ الإصلاح دائمًا ترحيلة جديدة.

## 6. الإغلاق

- شغّل `migration-drift` يدويًا: يجب أن يكون أخضر.
- أكمل سجل الإصدار: SHA، الترحيلات، نتائج التحقق، معرّف النشر، من نفّذ كل خطوة.
- أبلغ أصحاب المصلحة.

## § الانحراف (drift)

- `missing_in_db`: ترحيلة في المستودع لم تطبق. إن كانت جزءًا من هذا الإصدار فطبقها؛ إن كانت قديمة
  (مثل ملفات أُضيفت بعد أن طبقت محتواها Lovable بأسماء أخرى) فلا تطبقها قبل مقارنة الكائنات
  (`scripts/db/make-baseline.sh` يعطي فرق المخطط) — غالبًا الصحيح هو تسجيل الإصدار فقط بعد إثبات أن
  الكائنات موجودة ومطابقة.
- `unknown_in_repo`: تعديل طُبق على الإنتاج بدون ملف في المستودع (SQL Editor أو Lovable). استخرج
  التعريف (`supabase db dump` أو `pg_get_functiondef`) وأضفه كترحيلة بنفس رقم الإصدار في PR، أو
  اعكسه إن لم يكن مقصودًا.
- لا يُغلق الإصدار والانحراف قائم.
