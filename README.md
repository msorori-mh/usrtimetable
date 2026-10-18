# منصة إدارة الجداول الجامعية — usrtimetable

منصة إعداد ونشر الجداول الدراسية لجامعة إقليم سبأ: البيانات الأكاديمية، الإسناد، الجدولة الآلية
واليدوية، كشف التعارضات، النشر، والتقارير المطبوعة. واجهة عربية RTL بالكامل.

## التقنيات

- **الواجهة والخادم**: React 19 + TanStack Start/Router/Query، Vite 7، Tailwind 4، shadcn/ui،
  تُبنى عبر `@lovable.dev/vite-tanstack-config` وnitro (هدف Cloudflare Workers).
- **قاعدة البيانات والهوية**: Supabase (PostgreSQL + Auth + RLS). منطق الصلاحيات والكتابة في دوال
  SQL (`SECURITY DEFINER`) ضمن `supabase/migrations/`.
- **الجدولة**: محرك V2 في `src/lib/auto-scheduler/` مع نموذج رياضي عبر `highs`.
- **مدير الحزم**: Bun `1.4.2` (`bun.lock`).

## المتطلبات

- Bun 1.4.2، وNode.js 22 أو 24 (لاختبارات `node:test`).
- PostgreSQL 16 محليًا (اختياري، لاختبارات SQL).
- Supabase CLI (اختياري، لمسؤول الإصدار فقط).

## التشغيل محليًا

```bash
bun install --frozen-lockfile
cp .env.example .env      # ثم املأ القيم من مشروع Supabase للتطوير/الاختبار (ليس الإنتاج)
bun run dev
```

متغيرات البيئة (انظر `.env.example` — أسماء فقط):

| المتغير | أين | ملاحظة |
| --- | --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID` | المتصفح | مفاتيح عامة (publishable) فقط |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID` | الخادم | |
| `SUPABASE_SERVICE_ROLE_KEY` | الخادم فقط | تحقنه المنصة وقت التشغيل؛ **لا يُكتب في أي ملف** |

## الاختبارات

| الطبقة | الأمر | ما تحتاجه |
| --- | --- | --- |
| جرد الاختبارات | `bun run test:list` | — |
| وحدات (bun:test، vitest، node:test، سكربتات) | `bun run test` | `bun install` |
| حزمة harness الثابتة | `bun run test:harness` | `bun install` |
| قواعد بيانات PGlite | `PGLITE_MODULE=…/pglite/dist/index.js PASSWORD_QA_MODULES=…/node_modules bun run test:pglite` | `npm i --prefix /tmp/dbt @electric-sql/pglite@0.3.14 jsdom@26.1.0` |
| SQL على مخطط مُعاد بناؤه | `PGHOST=localhost PGUSER=postgres bun run test:sql` | PostgreSQL 16 محلي مؤقت |
| فحص الأنواع / lint | `bun run typecheck` / `bun run lint` | |
| ترحيلات لها rollback | `bun run check:rollbacks` | |

- `scripts/run-all-tests.mjs` يصنّف كل ملف في `tests/` حسب إطار الاختبار الذي يستورده ويشغّله
  بالأداة الصحيحة؛ أي ملف جديد يدخل CI تلقائيًا.
- `scripts/db/replay-migrations.sh <db>` يبني قاعدة شبيهة بـ Supabase من كل الترحيلات بالترتيب
  (`scripts/db/replay-order.txt`، والجديد يُلحق تلقائيًا). نحو 88 ملفًا تاريخيًا لا تُطبق على قاعدة
  فارغة (`replay-known-failures.txt`)؛ أي فشل جديد أو فشل ترحيلة ≥ `20261020000000` يُفشل التشغيل.
- `scripts/db/run-sql-tests.sh` يشغل `tests/*.sql` و`supabase/tests/*.sql` حسب `scripts/db/sql-tests.txt`.
  اختبار SQL جديد (`BEGIN; … DO $$ … RAISE EXCEPTION … $$; ROLLBACK;`) يُشغّل افتراضيًا على المخطط
  المُعاد بناؤه.
- لا تُشغّل أي سكربت على مشروع Supabase حقيقي؛ السكربتات ترفض مرجع الإنتاج المأخوذ من
  `supabase/config.toml`.

## بوابات CI

- **`pr-gate`** (كل PR وكل push إلى `main`، بلا مرشحات مسارات): `static` (tsc، eslint كامل،
  فحص rollback، لا مخرجات بناء ملتزمة)، `unit`، `pglite`، `db-tests` (postgres:16). **يجب أن تكون
  فحوصه الأربعة Required status checks لفرع `main`** (GitHub → Settings → Branches) — هذا إعداد في
  GitHub ولا يمكن فرضه من المستودع.
- `runtime-gates` وبقية الـ workflows الموضوعية تبقى كما هي.
- أسبوعيًا: `dependency-audit` (bun audit ≥ high)، `migration-drift` (مقارنة الترحيلات بالإنتاج —
  يحتاج السر `PROD_DB_READONLY_URL`)، وDependabot.
- `deploy-staging` يدوي/بوسم فقط، لبيئة staging المعزولة.

## الإصدار والتشغيل

- دليل الإصدار: [`docs/operations/release-runbook.md`](docs/operations/release-runbook.md)
- النسخ الاحتياطي والاستعادة وRPO/RTO: [`docs/operations/supabase-backup-restore.md`](docs/operations/supabase-backup-restore.md)
- خط أساس الترحيلات: [`docs/operations/migrations-baseline.md`](docs/operations/migrations-baseline.md)
- تجاوزات الاعتماديات وسلسلة التوريد: [`docs/operations/dependency-overrides.md`](docs/operations/dependency-overrides.md)
- قواعد العمل على المستودع: [`AGENTS.md`](AGENTS.md)

## قواعد الترحيلات

- ملف جديد فقط `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`؛ لا يُعدَّل ملف مطبق أبدًا.
- لكل ترحيلة جديدة `supabase/rollbacks/<same name>.down.sql`.
- دوال `SECURITY DEFINER`: `SET search_path = public, pg_temp` و`REVOKE ALL … FROM PUBLIC, anon` ثم
  GRANT صريح. العروض: `WITH (security_invoker = true)`.

## الأمان

- لا تُلتزم مفاتيح `service_role` أو كلمات مرور أو روابط قواعد بيانات أو ملفات `.env` (مُتجاهلة).
- المفتاح العام (publishable/anon) عام بطبيعته؛ الحماية الفعلية هي RLS والدوال على الخادم.
- لا تُلتزم مخرجات البناء (`dist*/`, `.output/`)؛ قد تحمل إعدادات مضمّنة.
- الإبلاغ عن ثغرة: تواصل مباشرة مع مالك المستودع بدل فتح issue عام.

---

## English summary

University timetabling platform (TanStack Start + React 19 + Supabase/Postgres, Arabic RTL UI).
Install with `bun install --frozen-lockfile` (Bun 1.4.2), copy `.env.example` to `.env`, run
`bun run dev`. Tests: `bun run test` (all unit frameworks, classified by
`scripts/run-all-tests.mjs`), `bun run test:harness`, `bun run test:pglite`, and
`bun run test:sql` against a local disposable PostgreSQL 16 (schema built by
`scripts/db/replay-migrations.sh`). The required CI check is the `pr-gate` workflow — make its
jobs required for `main` in the GitHub branch-protection settings. Releases follow
`docs/operations/release-runbook.md` (Lovable publish + ordered Supabase migrations). Never
commit service-role keys, database URLs or build output.
