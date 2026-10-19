# دليل الخروج من Lovable — الانتقال إلى Supabase مملوك للجامعة وCloudflare Workers

**القرار (مالك المنتج):** تنتقل قاعدة البيانات والمصادقة من Lovable Cloud (مشروع Supabase
`emzytxqkxjjhsivqxdiu` المُدار من Lovable) إلى **مشروع Supabase جديد تملكه الجامعة**، ويُستضاف التطبيق
على **Cloudflare Workers** من حساب الجامعة عبر `.github/workflows/deploy-production.yml`.

الحالة في المستودع بعد هذا المسار (`track/exit-lovable`):

- البناء لا يعتمد على أي حزمة Lovable (`vite.config.ts` صريح: TanStack Start + nitro `cloudflare_module`).
- `src/integrations/supabase/client.ts` لا يحوي أي عنوان أو مفتاح مشروع ثابت؛ يقرأ
  `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` وقت البناء (و`SUPABASE_URL` /
  `SUPABASE_PUBLISHABLE_KEY` على الخادم) ويفشل برسالة واضحة إن غابت.
- لا يُسمح بتضمين الموقع في إطار من أي مضيف (`frame-ancestors 'none'`).
- التطبيق لا يستخدم Storage ولا Edge Functions ولا pg_cron ولا Realtime. المصادقة: بريد/كلمة مرور +
  TOTP MFA + رسائل استعادة كلمة المرور.

> **قاعدة عامة:** كل أمر هنا يُنفّذ من جهاز مسؤول موثوق، والملفات الناتجة (`*.backup`, `*.sql`
> للبيانات) سرية لأنها تحوي تجزئات كلمات المرور وأسرار TOTP: لا تُرفع إلى Git ولا إلى artifacts،
> وتُحذف بأمان بعد انتهاء فترة الرجوع. لا يُنفذ أي أمر كتابة على مشروع Lovable القديم.

المتغيرات المستخدمة في الأوامر (اضبطها في الطرفية فقط، لا تحفظها في ملفات):

```bash
export NEW_REF='<project-ref الجديد>'                 # مثل abcdefghijklmnopqrst
export NEW_DB_URL='postgresql://postgres:<pw>@db.'"$NEW_REF"'.supabase.co:5432/postgres?sslmode=require'
export OLD_DB_READONLY_URL='postgresql://…'            # اتصال قراءة فقط بالقديم إن أتاحه Lovable، وإلا استخدم SQL Editor
export BACKUP=~/secure/lovable-export-$(date -u +%Y%m%d).backup
export DOMAIN='gomufadhala.com'                        # النطاق النهائي (قرار 19 أكتوبر: النطاق الحالي)
```

استخدم اتصال **Direct connection** (المنفذ 5432) أو **Session pooler** للاستعادة، لا Transaction
pooler (6543)، لأن `pg_restore`/`SET session_replication_role` تحتاج جلسة كاملة. أدوات العميل:
`pg_restore`/`psql` من **PostgreSQL 17** (أو الإصدار الرئيسي نفسه لقاعدة المشروع الجديد أو أحدث).

---

## 1) إنشاء مشروع Supabase الجامعي

1. أنشئ **Organization** باسم الجامعة في https://supabase.com/dashboard وأضف مالكين اثنين على الأقل
   (حسابات مؤسسية، MFA مفعّل لكل منهما). سجّل المالكين في `lovable-exit-checklist.md`.
2. **الخطة: Pro** (أو أعلى). المطلوب: النسخ الاحتياطية اليومية (7 أيام)، وإمكانية تفعيل **PITR**
   (إضافة مدفوعة) لتحقيق RPO بالدقائق، وحماية كلمات المرور المسربة، وعدم إيقاف المشروع تلقائيًا.
3. **المنطقة:** اختر الأقرب للمستخدمين ولخوادم Cloudflare التي ستخدمهم؛ للجامعة في اليمن تُرجَّح
   `eu-central-1` (فرانكفورت) أو `me-central-1` إن كانت متاحة لحسابك. **المنطقة لا تتغير بعد
   الإنشاء.** قِس زمن الاستجابة من شبكة الجامعة إلى المنطقتين قبل القرار
   (`curl -o /dev/null -s -w '%{time_connect}\n' https://<ref>.supabase.co`).
4. اسم المشروع: `usrtimetable-production`. كلمة مرور قاعدة البيانات: عشوائية ≥ 32 حرفًا، تُحفظ في خزنة
   كلمات المرور المؤسسية فقط.
5. بعد الإنشاء:
   - **Settings → API**: انسخ `Project URL` و`publishable` (أو `anon`) و`secret`/`service_role` إلى
     خزنة الأسرار (لا إلى Git).
   - **Database → Backups**: تأكد من ظهور النسخ اليومية؛ فعّل PITR إن اعتمدته الإدارة.
   - **Settings → Database → Network restrictions**: قيّد الوصول المباشر لقاعدة البيانات إلى عناوين
     الجامعة/مسؤولي قاعدة البيانات إن أمكن (لا يؤثر على PostgREST).
   - **Database → Extensions**: لا شيء الآن؛ تُنشأ الامتدادات في الخطوة 4.1.
6. حدّث المستودع (PR مستقل يمر بـ `pr-gate`):
   ```bash
   sed -i "s/^project_id = .*/project_id = \"$NEW_REF\"/" supabase/config.toml
   ```
   هذا شرط مسبق: `deploy-preflight.mjs --production` يرفض النشر ما دام `project_id` يساوي مشروع
   Lovable القديم أو يختلف عن `PROD_SUPABASE_PROJECT_ID`.

## 2) إعدادات المصادقة (Authentication) في المشروع الجديد

نفّذها **قبل** استعادة البيانات، وراجعها مع مسؤول ثانٍ.

| الإعداد | المكان في اللوحة | القيمة |
| --- | --- | --- |
| تعطيل التسجيل العام | Authentication → Sign In / Providers → *Allow new users to sign up* | **Off** (الحسابات تُنشأ من لوحة الإدارة بمفتاح الخدمة) |
| مزود البريد | Authentication → Sign In / Providers → Email | مفعّل، *Confirm email* مفعّل، *Secure email change* مفعّل |
| طول كلمة المرور | Authentication → Sign In / Providers → Email → Minimum password length | **12** |
| متطلبات كلمة المرور | نفس الصفحة → Password requirements | أحرف صغيرة وكبيرة وأرقام ورموز |
| حماية كلمات المرور المسربة | نفس الصفحة → *Prevent use of leaked passwords* | **On** (يتطلب Pro) |
| MFA | Authentication → Multi-Factor → TOTP | **Enabled** (التسجيل والتحقق) |
| Site URL | Authentication → URL Configuration → Site URL | `https://$DOMAIN` |
| Redirect URLs | Authentication → URL Configuration → Redirect URLs | `https://$DOMAIN/reset-password` (وللتجربة فقط قبل التحويل: `https://<worker>.<account>.workers.dev/reset-password` ثم احذفه) |
| مدة JWT | Settings → JWT Keys (أو Authentication → Sessions) | `3600` ثانية (الافتراضي)؛ لا تزدها |
| الجلسات | Authentication → Sessions | *Detect and revoke compromised refresh tokens* On؛ مهلة الخمول حسب سياسة الجامعة (مثلًا 12 ساعة) |
| حدود المعدل | Authentication → Rate Limits | ارفع حد رسائل البريد/ساعة بما يناسب SMTP الجامعة (مثلًا 100)؛ أبقِ حدود تسجيل الدخول الافتراضية |

### SMTP الجامعة

Authentication → Emails → SMTP Settings → *Enable custom SMTP*:

- Host / Port: خادم الجامعة (مثلًا `smtp.usr.edu.ye`، المنفذ `587` STARTTLS أو `465` TLS).
- Username / Password: حساب خدمة مخصص (`no-reply@usr.edu.ye`) بكلمة مرور تُحفظ في الخزنة.
- Sender email: `no-reply@usr.edu.ye`، Sender name: `منصة الجداول الدراسية — جامعة العلوم والتكنولوجيا`.
- اضبط **SPF وDKIM وDMARC** للنطاق المرسل لئلا تذهب الرسائل إلى البريد المزعج.

### قوالب البريد (عربية)

Authentication → Emails → Templates. عدّل على الأقل: *Reset Password*، *Confirm signup*، *Change Email
Address*، *Magic Link* (غير مستخدم لكن اجعله عربيًا)، *Reauthentication*. مثال *Reset Password*:

```html
<div dir="rtl" style="font-family: Tahoma, Arial, sans-serif; line-height: 1.8">
  <h2>إعادة تعيين كلمة المرور</h2>
  <p>تلقّينا طلبًا لإعادة تعيين كلمة المرور لحسابك في منصة الجداول الدراسية.</p>
  <p><a href="{{ .ConfirmationURL }}">اضغط هنا لتعيين كلمة مرور جديدة</a></p>
  <p>إن لم تطلب ذلك فتجاهل هذه الرسالة؛ لن يتغير شيء في حسابك.</p>
  <p>صلاحية الرابط محدودة ويُستخدم مرة واحدة.</p>
</div>
```

العنوان: `إعادة تعيين كلمة المرور — منصة الجداول الدراسية`. تأكد أن `{{ .ConfirmationURL }}` يعود إلى
`/reset-password` (يأتي من `redirectTo` في `src/routes/auth.tsx` و`src/lib/users.functions.ts`، ويُقبل
فقط إن كان ضمن Redirect URLs).

## 3) التصدير من Lovable Cloud

1. **أعلن تجميد التعديلات** (انظر § 8) قبل التصدير النهائي. التصدير التجريبي الأول يمكن أن يكون بدون
   تجميد لاختبار الخطوات 4–6 على مشروع تجريبي.
2. في Lovable: افتح المشروع → **More → Cloud → Overview → Advanced settings → Export project data**.
   اختر تصدير قاعدة البيانات الكاملة بصيغة **custom (`.backup`)** متضمنة مخطط **auth** (المستخدمون
   وتجزئات كلمات المرور وعوامل MFA). نزّل الملف إلى `$BACKUP` على جهاز مشفّر.
3. سجّل البصمة والحجم:
   ```bash
   sha256sum "$BACKUP" | tee "$BACKUP.sha256"; ls -l "$BACKUP"
   ```
4. افحص المحتوى (قائمة TOC فقط، بلا بيانات):
   ```bash
   pg_restore --list "$BACKUP" > toc.txt
   grep -E ' SCHEMA - ' toc.txt                       # المخططات الموجودة
   grep -E ' EXTENSION ' toc.txt                      # الامتدادات
   grep -E 'TABLE DATA auth (users|identities|mfa_factors) ' toc.txt   # يجب أن تظهر الثلاثة
   grep -E 'TRIGGER auth users ' toc.txt              # المشغلات التي أنشأها التطبيق على auth.users
   ```
   المتوقع في المشغلات: `on_auth_user_created`، `initial_password_for_new_account`،
   `admin_only_account_creation`. إن لم يظهر `TABLE DATA auth users` فالتصدير **لا يصلح**: أعد التصدير
   مع تضمين auth أو اطلب من دعم Lovable نسخة `pg_dump -Fc` كاملة.
5. اجمع من القديم (SQL Editor في Lovable Cloud، قراءة فقط) ما لا يحمله `pg_dump`:
   ```sql
   -- إعدادات الأدوار وقاعدة البيانات (pgrst.db_pre_request، statement_timeout …)
   select r.rolname, s.setconfig, d.datname
     from pg_db_role_setting s
     left join pg_roles r on r.oid = s.setrole
     left join pg_database d on d.oid = s.setdatabase;
   -- الامتدادات ومخططاتها
   select extname, extnamespace::regnamespace, extversion from pg_extension order by 1;
   -- مخططات التطبيق
   select nspname from pg_namespace
    where nspname = 'public' or nspname like '%\_private' order by 1;
   ```
   احفظ النتائج في سجل الانتقال.

## 4) الاستعادة في المشروع الجديد (`pg_restore`)

**لماذا لا نستعيد الملف كاملًا؟** مشروع Supabase الجديد يحوي مسبقًا مخططات المنصة (`auth`, `storage`,
`extensions`, `realtime`, `vault`, `graphql`, …) مملوكة لأدوار المنصة (`supabase_auth_admin` …).
استعادة كاملة ستصطدم بها (كائنات موجودة، ملكية، ترقيات مخطط auth تختلف بين الإصدارات). لذلك:

- **مخططات التطبيق** (`public` وكل `*_private`) → مخطط **مع الصلاحيات** ثم بيانات.
- **auth** → **بيانات فقط** لجداول محددة داخل الجداول التي أنشأتها المنصة.
- لا نستعيد `storage` (غير مستخدم) ولا `auth.schema_migrations` ولا الجلسات.

**لماذا مع الصلاحيات (`بدون --no-privileges`)؟** التطبيق يعتمد على GRANT/REVOKE صريحة في `public`
(EXECUTE على الدوال لـ `authenticated` فقط، سحب `anon`، صلاحيات جداول دقيقة — ترحيلات H-1 وL-9)
وعلى RLS. إسقاط الصلاحيات يجعل الكائنات تأخذ الصلاحيات الافتراضية للمنصة (تمنح `anon` الكثير). نستخدم
`--no-owner` فقط ليملك `postgres` الكائنات (كما في أي مشروع Supabase).

### 4.1 الامتدادات (قبل المخطط)

أنشئ ما ظهر في الخطوة 3.5 بالمخطط نفسه (المتوقع في هذا المشروع):

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
create extension if not exists btree_gist with schema public;      -- قيود EXCLUDE USING gist
create extension if not exists pgcrypto   with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_trgm    with schema extensions;   -- فقط إن ظهر في القديم
SQL
```

### 4.2 مخطط التطبيق (public + *_private) مع الصلاحيات

```bash
SCHEMAS=(public assignment_version_private education_source_revision_private faculty_private
  itcs_cutover_private provisioning_private schedule_coordination_private teaching_pay_private
  schedule_version_delivery_private jawf_term_source_private)
# قارن القائمة بنتيجة الاستعلام في 3.5 وأضف أي مخطط *_private جديد.
NS=(); for s in "${SCHEMAS[@]}"; do NS+=(--schema="$s"); done

pg_restore --schema-only --no-owner "${NS[@]}" --file=app-schema.sql "$BACKUP"
```

راجع `app-schema.sql` قبل التطبيق:

```bash
grep -nE '^(CREATE|ALTER) SCHEMA public' app-schema.sql      # احذف CREATE SCHEMA public إن وُجد (موجود مسبقًا)
grep -noE '(TO|FROM) [a-z_]+' app-schema.sql | awk '{print $2}' | sort | uniq -c
#   يجب أن تقتصر الأدوار على: anon authenticated service_role postgres PUBLIC
#   (وأحيانًا supabase_auth_admin). أي دور آخر خاص بـLovable: أنشئه أو احذف سطوره بعد مراجعة.
grep -n 'DEFAULT PRIVILEGES' app-schema.sql                   # الصلاحيات الافتراضية في public
grep -nE 'COMMENT ON (SCHEMA|EXTENSION)' app-schema.sql
```

أسطر يجب حذفها عادةً (تخص أدوار المنصة ولا يملك `postgres` تعديلها، والمشروع الجديد يحمل مكافئها):
`ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin …`، و`COMMENT ON SCHEMA public`/`COMMENT ON EXTENSION`.
أبقِ `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public …` وكل `GRANT`/`REVOKE` على كائنات
التطبيق. وثّق كل سطر محذوف في سجل الانتقال.

ثم طبّق في معاملة واحدة:

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f app-schema.sql
```

ملاحظات:
- المفاتيح الأجنبية نحو `auth.users` (13 مرجعًا) تُنشأ هنا على جداول فارغة — صحيح.
- المشغلات على `auth.users` **ليست** في هذا الملف (تنتمي لمخطط auth)؛ تُنشأ في 4.5 بعد البيانات حتى لا
  تعمل أثناء الاستعادة.

### 4.3 سجل الترحيلات (`supabase_migrations`)

ضروري ليبقى `scripts/db/migration-drift.sh` صحيحًا:

```bash
psql "$NEW_DB_URL" -Atc "select to_regclass('supabase_migrations.schema_migrations')"
# فارغ  → استعد المخطط والبيانات معًا:
pg_restore --no-owner --schema=supabase_migrations --file=migrations-ledger.sql "$BACKUP"
# موجود → بيانات فقط (بعد مقارنة الأعمدة بين الطرفين بـ \d):
pg_restore --data-only --schema=supabase_migrations --file=migrations-ledger.sql "$BACKUP"
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f migrations-ledger.sql
```

### 4.4 البيانات: auth أولًا (بيانات فقط) ثم التطبيق

قارن أولًا أعمدة جداول auth بين الطرفين (إصدار GoTrue قد يختلف):

```bash
pg_restore --schema-only --schema=auth --table=users --table=identities --table=mfa_factors \
  --file=- "$BACKUP" | grep -A80 'CREATE TABLE auth.users' | head -90
psql "$NEW_DB_URL" -c '\d auth.users' -c '\d auth.identities' -c '\d auth.mfa_factors'
```

`pg_restore` يكتب `COPY auth.users (col1, col2, …)` بقائمة أعمدة صريحة، والأعمدة المولّدة
(`confirmed_at`، `identities.email`) لا تُنسخ: عمود **إضافي** في الجديد مقبول (له افتراضي)، أما عمود
موجود في القديم وغير موجود في الجديد فيجب حذفه من سطر COPY وقيمه قبل التطبيق (نادر؛ أوقف وراجع).

```bash
pg_restore --data-only --schema=auth \
  --table=users --table=identities --table=mfa_factors \
  --file=auth-data.sql "$BACKUP"

pg_restore --data-only "${NS[@]}" --file=app-data.sql "$BACKUP"
```

طبّق الملفين في **معاملة واحدة** مع `session_replication_role = replica` (يعطّل المشغلات وفحوص
المفاتيح الأجنبية أثناء التحميل فقط — الطريقة الرسمية لنقل مشاريع Supabase؛ لا تعمل مشغلات التدقيق ولا
`handle_new_user` فتُكرر صفوفًا):

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c 'SET session_replication_role = replica' \
  -f auth-data.sql \
  -f app-data.sql \
  -c 'SET session_replication_role = origin'
```

لا تنقل: `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_challenges`, `auth.mfa_amr_claims`,
`auth.flow_state`, `auth.one_time_tokens`, `auth.audit_log_entries` (المستخدمون سيسجلون الدخول من جديد).

### 4.5 المشغلات على auth.users وإعدادات الأدوار

```bash
grep -E 'TRIGGER auth users ' toc.txt > auth-triggers.list
pg_restore --use-list=auth-triggers.list --file=auth-triggers.sql "$BACKUP"
cat auth-triggers.sql            # يجب أن يحوي الثلاثة فقط
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 --single-transaction -f auth-triggers.sql
```

خطّاف PostgREST لفرض تغيير كلمة المرور الأولى (إعدادات الأدوار لا يحملها `pg_dump`):

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.enforce_initial_password_change';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
SQL
```

وأعد أي إعداد آخر ظهر في استعلام `pg_db_role_setting` (3.5)، مثل `statement_timeout` للأدوار
`authenticated`/`anon`، بالصيغة نفسها: `ALTER ROLE <role> SET statement_timeout = '<قيمة القديم>';`.

### 4.6 تحقق فوري بعد الاستعادة

```bash
psql "$NEW_DB_URL" -Atc "select rolconfig from pg_roles where rolname='authenticator'"
psql "$NEW_DB_URL" -c '\ddp public'                      # الصلاحيات الافتراضية
psql "$NEW_DB_URL" -Atc "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"   # المتوقع 0
```

## 5) تطبيق ترحيلات المعالجة الجديدة

الملفات `supabase/migrations/2026102*` (من `20261020000100_q1_lock_import_academic_structure.sql`
فصاعدًا) قد لا تكون طُبقت على Lovable. **لا تستخدم `supabase db push` أعمى ولا `--include-all`.** اتبع
`docs/operations/release-runbook.md` (الأقسام 0–3 و6) على المشروع الجديد:

```bash
# الترحيلات الناقصة في المشروع الجديد بحسب السجل المنقول في 4.3
PROD_DB_READONLY_URL="$NEW_DB_URL" scripts/db/migration-drift.sh
```

- المتوقع في `missing_in_db`: ترحيلات المعالجة ذات الطوابع ≥ `20261020000000` فقط، وربما ملفات تاريخية
  معروفة (§ الانحراف في دليل الإصدار). أي `unknown_in_repo` → **توقف**.
- طبّقها **بالترتيب**، ملفًا ملفًا، بالخيار أ (CLI بعد `supabase link --project-ref "$NEW_REF"` و
  `supabase db push --dry-run` لمراجعة القائمة) أو الخيار ب (SQL Editor + إدخال السجل)، ونفّذ استعلامات
  التحقق في § 3 من دليل الإصدار بعد كل ملف. لكل ملف rollback في `supabase/rollbacks/`.
- بعد الانتهاء يجب أن يعطي `migration-drift.sh` نتيجة خضراء.

## 6) التحقق الشامل

### 6.1 المخطط: القديم ↔ الجديد ↔ المستودع

```bash
# مخطط القديم (قبل ترحيلات المعالجة) من ملف التصدير نفسه — بلا اتصال بالقديم:
pg_restore --schema-only --no-owner --no-privileges "${NS[@]}" -f supabase/reference/prod-schema-old-lovable.sql "$BACKUP"
# مخطط الجديد:
BASELINE_DATE=new-univ PROD_DB_READONLY_URL="$NEW_DB_URL" scripts/db/make-baseline.sh dump
# مخطط المستودع المعاد تشغيله (PostgreSQL محلي مؤقت):
BASELINE_DATE=new-univ scripts/db/make-baseline.sh replay
scripts/db/make-baseline.sh diff supabase/reference/prod-schema-new-univ.sql supabase/reference/replay-schema-new-univ.sql
```

- قبل الخطوة 5: الفرق بين `prod-schema-old-lovable.sql` و`prod-schema-new-univ.sql` يجب أن يكون صفرًا.
- بعد الخطوة 5: فرق الجديد مع replay يجب ألا يتجاوز الانحراف التاريخي الموثق في
  `docs/operations/migrations-baseline.md`.
- لا تُرفع ملفات `prod-schema-old-lovable.sql` إن احتوت أسماء حساسة؛ هي مخطط فقط (لا بيانات).

### 6.2 عدد الصفوف لكل جدول (شغّله على الطرفين وقارن)

```sql
select n.nspname || '.' || c.relname as table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text::bigint as row_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p')
   and (n.nspname = 'public' or n.nspname like '%\_private'
        or n.nspname = 'supabase_migrations'
        or (n.nspname = 'auth' and c.relname in ('users', 'identities', 'mfa_factors')))
 order by 1;
```

```bash
# القديم: نفّذ الاستعلام في SQL Editor لـLovable وصدّر النتيجة CSV → counts-old.csv
psql "$NEW_DB_URL" -At -F, -f row-counts.sql > counts-new.csv     # row-counts.sql = الاستعلام أعلاه
diff <(sort counts-old.csv) <(sort counts-new.csv) && echo "ROW COUNTS MATCH"
```

يجب التطابق التام (قبل تطبيق ترحيلات المعالجة التي قد تضيف صفوفًا؛ إن طبّقتها فاشرح كل فرق).

### 6.3 الأمان

```bash
psql "$NEW_DB_URL" -v ON_ERROR_STOP=1 -f tests/security-anon-definer-guard.sql   # BEGIN…ROLLBACK، يجب ألا يرفع استثناء
```

ونفّذ استعلامات § 3 (2–4) من `release-runbook.md`. وفي اللوحة: **Advisors → Security Advisor** بلا
أخطاء جديدة.

### 6.4 اختبارات وظيفية (على Worker تجريبي يشير للمشروع الجديد، قبل تحويل DNS)

| الاختبار | الخطوات | المتوقع |
| --- | --- | --- |
| دخول لكل دور | حساب تجريبي لكل دور: super_admin، عميد كلية، منسق، مُشاهد مؤسسي، محاضر | يدخل بكلمة مروره **القديمة** ويرى نطاقه فقط |
| MFA | حساب لديه TOTP مسجّل مسبقًا | يُطلب الرمز ويقبل رمز التطبيق نفسه (العامل منقول) |
| استعادة كلمة المرور | "نسيت كلمة المرور" من `/auth` لحساب حقيقي للمسؤول | تصل رسالة عربية من SMTP الجامعة، والرابط يفتح `/reset-password` على النطاق الصحيح |
| إعادة تعيين من الإدارة | لوحة المستخدمين → إعادة تعيين | الرابط يستخدم `SITE_URL` |
| كلمة المرور الأولى | إنشاء حساب جديد من الإدارة | يُجبر على تغيير كلمة المرور (خطّاف `db_pre_request` يعمل) |
| حساب معطّل | تعطيل حساب ثم محاولة الدخول | يُرفض |
| قراءة التقارير والطباعة | `/reports` وطباعة PDF لجدول منشور | تطابق النسخة القديمة |

إن رُفض رمز TOTP لكل الحسابات (أسرار العوامل مرتبطة بمفتاح تشفير المشروع القديم): ألغِ عوامل الحسابات
المتأثرة من لوحة الإدارة ودع المستخدمين يعيدون التسجيل، وأعلن ذلك في رسالة التحويل.

## 7) Cloudflare

1. **الحساب:** حساب Cloudflare باسم الجامعة، مالكان على الأقل، MFA إلزامي.
2. **النطاق (قرار 19 أكتوبر: `gomufadhala.com`، النطاق الحالي):** تُضاف منطقته إلى Cloudflare
   (Full setup) لاستخدام *Custom Domains* للـWorker. أثناء الإضافة تُستورد سجلات DNS الحالية كما هي
   (الموقع يبقى على Lovable، وسجلات البريد MX/TXT إن وُجدت)، ثم تُغيَّر خوادم الأسماء عند المسجّل.
   لا يتغير شيء للمستخدمين حتى يوم الانتقال، حين يحل Custom Domain للـWorker محل سجل Lovable ويُفصل
   النطاق من إعدادات Lovable.
3. **رمز API:** My Profile → API Tokens → Create Token → قالب *Edit Cloudflare Workers* مقيد بالحساب
   والمنطقة (Workers Scripts:Edit، Workers Routes:Edit، Zone:Read، DNS:Edit للنطاق المخصص). مدة صلاحية
   سنة، ويُدوَّر.
4. **GitHub → Settings → Environments → `production`:**
   - *Required reviewers*: مراجع واحد على الأقل غير المنفّذ، مع *Prevent self-review*.
   - *Deployment branches*: `main` فقط.
   - Variables: `PROD_WORKER_NAME=usrtimetable`، `PROD_ROUTE=$DOMAIN`.
   - Secrets: `CLOUDFLARE_ACCOUNT_ID`، `CLOUDFLARE_API_TOKEN`، `PROD_SUPABASE_URL`،
     `PROD_SUPABASE_PROJECT_ID`، `PROD_SUPABASE_PUBLISHABLE_KEY`، `PROD_SUPABASE_SERVICE_ROLE_KEY`،
     `PROD_SITE_URL=https://$DOMAIN`.
5. **ملف القفل:** قبل أول نشر، شغّل مرة واحدة على جهاز متصل بالإنترنت ثم ادمج النتيجة عبر PR:
   ```bash
   scripts/exit-lovable/regenerate-lockfile.sh   # يعيد توليد bun.lock من registry.npmjs.org ويبني
   ```
   حتى يتم ذلك يفشل `bun install --frozen-lockfile` في `pr-gate` وفي workflows النشر.
6. **النشر الأول:** Actions → `deploy-production` → Run workflow على `main`: `sha` = الـSHA الكامل
   لآخر commit على `main` اجتاز `pr-gate`، و`confirmation` = `deploy-production`. يوافق المراجع، ثم:
   preflight → tsc → اختبارات → بناء → ربط `wrangler.json` بالاسم والنطاق (`workers_dev=false`) →
   نشر → فحص دخاني لـ`/` و`/auth` (200 + ترويسات الأمان).
   - لاختبار 6.4 قبل التحويل: انشر أولًا بـ`PROD_ROUTE` نطاقًا فرعيًا مؤقتًا (مثل `new.$DOMAIN`) مع
     `PROD_SITE_URL` المطابق، أو استخدم staging (`deploy-staging.yml`) بمشروع Supabase تجريبي.
7. **الرجوع في Cloudflare:** `npx wrangler@4.136.3 rollback --name usrtimetable` (أو Workers →
   usrtimetable → Deployments → Rollback). لا يمس قاعدة البيانات.

## 8) يوم التحويل (Cutover)

| الوقت | الخطوة | المسؤول |
| --- | --- | --- |
| T-7 أيام | تجربة كاملة للخطوات 3–6 على مشروع Supabase تجريبي من تصدير غير نهائي؛ قياس المدة | مسؤول قاعدة البيانات |
| T-3 أيام | إعلان نافذة الصيانة للمستخدمين (عربي): التوقف المتوقع، وأن **الجميع سيسجل الدخول من جديد** | مالك المنتج |
| T-1 يوم | خفض TTL لسجل DNS للنطاق إلى 300 ثانية؛ التأكد من اكتمال إعدادات § 2 و§ 7 | مسؤول البنية |
| T-0 | **تجميد:** لا تعديلات في Lovable (لا محادثات وكيل، لا Publish)، ولا استخدام للمنصة (رسالة صيانة) | مالك الإصدار |
| T+0:10 | التصدير النهائي (§ 3) والتحقق من البصمة | مسؤول قاعدة البيانات |
| T+0:30 | الاستعادة (§ 4) وترحيلات المعالجة (§ 5) والتحقق (§ 6.1–6.3) | مسؤول قاعدة البيانات + مراجع |
| T+1:30 | نشر `deploy-production` على النطاق النهائي (§ 7.6)؛ اختبارات 6.4 | مالك الإصدار |
| T+2:00 | تحويل DNS: سجل النطاق إلى Custom Domain للـWorker (يُنشأ تلقائيًا بالنشر إن كانت المنطقة على Cloudflare)؛ إزالة أي سجل يشير إلى Lovable | مسؤول البنية |
| T+2:15 | فحص دخاني من شبكة الجامعة ومن الجوال؛ رسالة "عادت الخدمة" | مالك المنتج |

**الرجوع خلال التحويل:** إن فشل أي تحقق قبل تحويل DNS، أوقف وأبقِ Lovable كما هو (لم يتغير). بعد
التحويل وقبل أي كتابة مهمة في الجديد: أعد DNS إلى Lovable. بعد بدء الكتابة في الجديد، الرجوع يعني فقدان
تلك الكتابات — القرار لمالك المنتج.

**فترة الأمان (أسبوعان):** يبقى مشروع Lovable **للقراءة فقط** (لا Publish، لا تعديلات، تعطيل الوصول
العام إن أمكن أو ترك واجهة قديمة غير مرتبطة بالنطاق) كمرجع رجوع ومقارنة.

**التنظيف بعد أسبوعين** (بموافقة مالك المنتج):

1. احذف السر `LOVABLE_API_KEY` من GitHub (Settings → Secrets) ومن أي خزنة أو CI.
2. افصل مزامنة GitHub من Lovable (Lovable → Project → GitHub → Disconnect) وألغِ تثبيت تطبيق Lovable
   GitHub App من المؤسسة/المستودع (GitHub → Settings → Applications) أو قيّده.
3. صدّر نسخة أخيرة من Lovable للأرشيف (مشفرة، مع مدة احتفاظ محددة)، ثم أرشف مشروع Lovable أو احذفه.
4. احذف ملفات `*.backup` و`*-data.sql` المؤقتة بأمان (`shred -u`) واحتفظ فقط بالأرشيف المعتمد.
5. احذف عناوين `workers.dev` أو النطاقات المؤقتة من Redirect URLs في Supabase.
6. حدّث `docs/operations/release-runbook.md` إن تغير أي إجراء أثناء التنفيذ، وسجّل التحويل في
   `docs/operations/releases/`.

## 9) ما يلاحظه المستخدمون

- **يجب على الجميع تسجيل الدخول من جديد**: المشروع الجديد له مفاتيح توقيع JWT مختلفة، والجلسات القديمة
  لا تُنقل.
- **كلمات المرور تبقى كما هي** (تجزئات bcrypt منقولة في `auth.users`)، و**عوامل TOTP تُنقل** في
  `auth.mfa_factors` فلا حاجة لإعادة المسح — مع التحفظ في نهاية 6.4.
- روابط استعادة كلمة المرور التي أُرسلت قبل التحويل تتوقف؛ يُطلب رابط جديد.
- لا يتغير عنوان المنصة إن بقي النطاق نفسه.

## ملحق: مراجع

- `docs/operations/lovable-exit-checklist.md` — قائمة التنفيذ بالمسؤولين.
- `docs/operations/release-runbook.md` — تطبيق الترحيلات والإصدار.
- `docs/operations/supabase-backup-restore.md` — تمارين الاستعادة وRPO/RTO.
- `.github/workflows/deploy-production.yml` و`scripts/staging/deploy-preflight.mjs --production`.
- `scripts/exit-lovable/regenerate-lockfile.sh` — إعادة توليد ملف القفل.
