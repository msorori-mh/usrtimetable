# Apply package — data classification (Lovable-managed only)

**DO NOT APPLY** without explicit `APPROVE_DB_MIGRATION_APPLY`.

Mission: `DEMO-OPERATIONAL-DATA-SEPARATION-01` Phase 3  
Decision gate: `PHASE_3_SOURCE_READY_WAITING_FOR_EXPLICIT_MIGRATION_APPROVAL`

## Migration

- File: `supabase/migrations/20260731120000_source_only_data_classification.sql`
- SHA256: `30C29D423DE6995543415492BE13C3FC26F045704333817E99BCA85087B9ED87`
- Forward-only / source-only until approved
- Project ref (Lovable-managed): `emzytxqkxjjhsivqxdiu`
- **Not in applied list** until remote evidence after approved apply

## What this migration does

- Adds nullable `public.schedule_versions.data_classification text DEFAULT NULL`
- CHECK: `NULL` OR `IN ('test','demo','operational','archived')`
- Trigger: only `super_admin` may set/change the column (`DATA_CLASSIFICATION_SUPER_ADMIN_REQUIRED`)
- REVOKE trigger function from PUBLIC / anon / authenticated
- Fixed `search_path = public, pg_temp`
- **No** Legacy table changes
- **No** UPDATE/backfill of existing rows (does **not** convert current records to Operational)
- **No** targeted Demo backfill in this mission (explicitly deferred)
- `import_runs`: **skipped** (table absent from current schema/types)

## What this migration does NOT do

- Does not purge or delete schedule data
- Does not touch protected version row `835e50fe-3ad2-4232-8c15-0f403c668a7f`
- Does not grant PUBLIC/anon privileges
- Does not publish / merge / Lovable-publish

## Before checks (read-only)

1. Confirm migration file SHA256 matches this package:
   `30C29D423DE6995543415492BE13C3FC26F045704333817E99BCA85087B9ED87`
2. Protected version `835e50fe-3ad2-4232-8c15-0f403c668a7f`: exists; do not UPDATE it in apply SQL.
3. Confirm `data_classification` column is **absent** before apply (or inventory if partially present).
4. Confirm `import_runs` still absent (skip remains valid) or plan follow-up migration if introduced.
5. Confirm no concurrent Operational go-live that assumes all rows are Operational.

### Suggested before SQL (read-only)

```sql
SELECT column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'schedule_versions'
  AND column_name = 'data_classification';

SELECT id, name, status, notes
FROM public.schedule_versions
WHERE id = '835e50fe-3ad2-4232-8c15-0f403c668a7f';

SELECT to_regclass('public.import_runs') AS import_runs_table;
```

## Apply path

Apply **only** through Lovable-managed Supabase migration apply UI/path for project `emzytxqkxjjhsivqxdiu`.

Forbidden: Supabase CLI against production, raw `DATABASE_URL`, service_role keys for ad-hoc ALTER, manual mass UPDATE to `operational`.

## After checks

1. Column `data_classification` exists; default NULL.
2. CHECK rejects values outside `{NULL,test,demo,operational,archived}`.
3. Non-super_admin INSERT/UPDATE of classification → `DATA_CLASSIFICATION_SUPER_ADMIN_REQUIRED`.
4. Protected version row unchanged (no unexpected classification write).
5. No rows were bulk-set to `operational` by the migration itself:

```sql
SELECT data_classification, COUNT(*)
FROM public.schedule_versions
GROUP BY 1;

SELECT id, data_classification
FROM public.schedule_versions
WHERE id = '835e50fe-3ad2-4232-8c15-0f403c668a7f';
```

Expected immediately after apply: all existing rows remain `NULL` (or unchanged); protected id still present.

## Rollback / containment

- Migration is additive (nullable column + check + trigger). Containment if applied early:
  - Leave column unused; UI continues to use markers + optional column read.
  - Do **not** mass-UPDATE rows to `operational`.
  - Emergency: revoke ability for non-super_admin already enforced by trigger; do not drop column in production without a separate approved forward migration.
- Never DELETE schedule rows to “undo” classification.
- Demo → Operational convert remains **unimplemented** until a future official path mission.

## Protected version

Hard product constant (also in source helpers):

`835e50fe-3ad2-4232-8c15-0f403c668a7f`

This apply package must not UPDATE, DELETE, or reclassify that version.

## Post-apply UI note (source already prepared)

After approved apply, clients may include `data_classification` in `schedule_versions` selects. Until then, source falls back to `DELIVERY_DEMO` name/notes markers.

## Merge / publish policy for this PR

- PR: Ready + CI green → **DO NOT merge** while merge depends on migration being applied (or while waiting for explicit migration approval per mission).
- **DO NOT** Lovable publish from this mission.
- **DO NOT** apply migration without explicit `APPROVE_DB_MIGRATION_APPLY`.
