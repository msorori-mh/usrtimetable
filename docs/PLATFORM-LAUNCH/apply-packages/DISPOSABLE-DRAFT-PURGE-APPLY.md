# Apply package — disposable draft purge (Lovable-managed only)

**DO NOT APPLY** without explicit `APPROVE_DB_MIGRATION_APPLY`.

## Migration

- File: `supabase/migrations/20260730120000_source_only_disposable_draft_purge.sql`
- SHA256: `37044CE37F453CAC650D68DCFD69A91B5779FC4A6AD8ADF3C3AD114546CB776B`
- Forward-only / source-only until approved
- Project ref (Lovable-managed): `emzytxqkxjjhsivqxdiu`

## Affected objects

- Column: `public.schedule_versions.disposable_test`
- Function/trigger: `enforce_disposable_test_super_admin_only` / `trg_sv_disposable_test_super_admin`
- Function: `public.purge_disposable_draft_schedule_version(uuid)`
- Grants: REVOKE FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO authenticated + service_role (in-function `is_super_admin` required)

## Dependent tables purged (scoped by version + college)

- `schedule_quality_runs`
- `schedule_version_conflict_exceptions`
- `conflict_results` (via conflict_check_id)
- `conflict_checks`
- `auto_schedule_runs`
- `schedule_version_events`
- `schedule_sessions`
- `schedule_versions`

## Before checks (read-only)

1. Protected version `835e50fe-3ad2-4232-8c15-0f403c668a7f`: status=draft, sessions=54, not approved/published.
2. Confirm migration file SHA256 matches this package.
3. Confirm no production test disposable versions exist yet (or inventory them).

## Apply path

Apply **only** through Lovable-managed Supabase migration apply UI/path for project `emzytxqkxjjhsivqxdiu`.

Forbidden: Supabase CLI, `DATABASE_URL`, service_role keys, manual SQL purge.

## After checks

1. Column `disposable_test` exists with default false.
2. `purge_disposable_draft_schedule_version` exists; EXECUTE revoked from PUBLIC/anon default path.
3. Call as non-super_admin → `PURGE_SUPER_ADMIN_REQUIRED`.
4. Call on protected UUID → `PURGE_PROTECTED_VERSION`.
5. Protected sessions remain 54; checksum unchanged.

## Rollback / containment

- Migration is additive (column default false + new function). Containment: leave RPC unused; do not mark production versions disposable.
- If applied erroneously: do not drop column in production without separate approval; revoke EXECUTE from authenticated as emergency containment via Lovable-managed SQL approval only.
- Never manually DELETE schedule rows to “undo”.

## Proof protected version cannot be purged

RPC hard-codes:

```sql
IF p_version_id = '835e50fe-3ad2-4232-8c15-0f403c668a7f'::uuid THEN
  RAISE EXCEPTION 'PURGE_PROTECTED_VERSION' ...
```

and final DELETE includes `AND id <> v_protected`.

## Post-apply RBAC live scenario (not run in this overnight Path B)

1. super_admin clone with `disposableTest: true` named `RBAC-TEST-ITCS-OVERNIGHT-01`.
2. college_admin matrix on test version only; rollback sessions/lifecycle to draft.
3. read_only denial matrix.
4. super_admin `purgeDisposableDraftScheduleVersion(testId)`.
5. Verify orphans=0; protected 54 unchanged.

## Test accounts checklist

| Role | Account (existing) | Post-apply actions |
|------|--------------------|--------------------|
| super_admin | owner session | create disposable clone, purge |
| college_admin | e.g. omar@gmail.com / a@a.com | CRUD/lifecycle on test version only |
| read_only | readonly@usr.edu.ye | view/export only; writes denied |
