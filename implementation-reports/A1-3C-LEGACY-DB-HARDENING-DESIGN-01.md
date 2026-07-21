# A1.3c — Legacy DB Write Hardening Design (DRAFT — SOURCE ONLY)

**Status:** `DESIGN_ONLY — NOT APPLIED`
**Gates:** apply only after (1) A1.3b remediation executed + verified under
`APPROVE_LEGACY_DATA_REMEDIATION`, and (2) explicit `APPROVE_DB_MIGRATION_APPLY`.
**Artifact:** `supabase/migrations/20260721090000_source_only_legacy_write_hardening.sql`
(first line carries the `SOURCE ONLY — NOT APPLIED — DRAFT` marker).

## 1. Goal

Deny **new** writes to the Legacy tables `sections` and `course_offering_sections`
at the database layer, while keeping all historical rows readable (`SELECT` untouched).
No data mutation, no backfill, no deletion is performed by this migration.

Layered model after A1.3:

| Layer | Mechanism | Status |
| --- | --- | --- |
| UI — `/sections` page | read-only; write controls gated (`LEGACY_SECTIONS_WRITE_BLOCKED`) | A1.3a (this PR) |
| UI — import client | `commitImport` refuses LEGACY_ONLY jobs (`import_legacy_entity_blocked`) | A1.3a (this PR) |
| Import catalog | LEGACY_ONLY hidden (PR #59) + kept hidden (harness) | done/enforced |
| DB — tables | row triggers reject INSERT/UPDATE/DELETE + DML grants revoked | **A1.3c draft** |
| DB — import dispatcher | legacy apply helpers replaced by raising versions | documented follow-up (§6) |

## 2. Mechanism comparison (why triggers)

| Option | Blocks PostgREST DML | Blocks SECURITY DEFINER RPC paths | Keeps history readable | Verdict |
| --- | --- | --- | --- | --- |
| `REVOKE` only | yes | **no** — definer runs as owner | yes | insufficient alone |
| RLS policy | yes | no (definer/owner bypass unless FORCE) | yes | possible complement, not chosen for draft |
| **BEFORE row trigger raising exception** | yes | **yes** — fires for every role | yes | **chosen** |
| Trigger + `REVOKE` combined | yes | yes | yes | **chosen (draft)** |

## 3. Design of the draft

1. `public.legacy_write_blocked()` — trigger function:
   - Raises `LEGACY_WRITE_BLOCKED: <table> is a Legacy table; new writes are blocked (A1.3c). Historical data remains readable.` with `ERRCODE 42501` (consistent with existing privilege-reject style in the codebase).
   - **Maintenance allowlist:** if `current_setting('app.legacy_write_allow', true) = 'on'`
     the write is allowed. The window is opened only via `SET LOCAL` in a direct SQL
     session by an approved operator (e.g., the A1.3b remediation run or a future
     history-maintenance procedure). PostgREST roles cannot set custom GUCs through
     the API, so the New Flow can never open it.
2. Triggers `legacy_write_block` on `public.sections` and
   `public.course_offering_sections` — `BEFORE INSERT OR UPDATE OR DELETE ... FOR EACH ROW`.
3. `REVOKE INSERT, UPDATE, DELETE` on both tables from `PUBLIC, anon, authenticated`
   (belt-and-suspenders for PostgREST; `SELECT` remains granted).

## 4. Threat paths covered

| Write path (A1 inventory) | Covered by | Notes |
| --- | --- | --- |
| sections.tsx CRUD (paths #1–3) | A1.3a UI gate + DB trigger/revoke | double layer |
| Import apply `_import_apply_sections` / `_import_apply_section_groups` (#4–5) | DB trigger blocks table write even from SECURITY DEFINER dispatcher; §6 follow-up replaces helpers with raising versions | trigger is the backstop |
| Legacy TA import writing `section_id` (#6) | §6 follow-up (raising V1 branch); TA table itself is **not** write-blocked (TA V2 writes the same table) | see §7 |
| Timetable editor saving `schedule_sessions.section_id` (#7) | not blocked by this draft (schedule_sessions is a live V2 table) | remediation tracked separately (A1.4/builder scope) |
| Greedy scheduler / version clone propagating `section_id` (#8) | same as #7 | documented, out of A1.3c scope |

`teaching_assignments` must **not** receive the write-blocking trigger: TA V2
(New Flow) writes the same physical table. V1-specific blocking belongs to the
import-dispatcher follow-up (§6), not table-level triggers.

## 5. Apply order and dependency

1. **A1.3b first:** remediate 174 TA + 5 COS under `APPROVE_LEGACY_DATA_REMEDIATION`
   (backup → dry-run → execute → checksums verified). If the trigger were applied
   first, remediation would need the GUC window for every statement — workable but
   needlessly risky; ordering remediation-first keeps the hardening clean.
2. **A1.3c second:** apply this migration under `APPROVE_DB_MIGRATION_APPLY`.
3. Verification post-apply (disposable DB proof, per A1 test-plan gate 9):
   - `INSERT/UPDATE/DELETE` on both tables as `authenticated` → `42501` LEGACY_WRITE_BLOCKED.
   - Same as `service_role`/owner without the GUC → blocked (trigger fires).
   - Same with `SET LOCAL app.legacy_write_allow = 'on'` → allowed (maintenance window).
   - `SELECT` on both tables → succeeds (history readable).
   - New-Flow generation (cohort curriculum, delivery groups, TA V2, builder) →
     sections/COS counts unchanged; no LEGACY_WRITE_BLOCKED raised on V2 paths.
   - Rollback rehearsal: `DROP TRIGGER` + re-`GRANT` forward reversal restores prior
     write capability without any row change.

## 6. Documented follow-ups (not in this draft)

- Replace `_import_apply_sections`, `_import_apply_section_groups`, and the V1 branch
  of `_import_apply_teaching_assignments` with raising versions, copying exact
  signatures from `20260718210000_source_only_atomic_import_job_commit.sql`.
- Optional: extend the trigger to `section_groups` / `section_group_members` after
  their remediation design exists.
- Optional: deny `schedule_sessions.section_id` writes once builder/greedy/clone
  propagation paths are remediated (A1 inventory write-paths #7/#8).

## 7. Rollback plan

Forward-only reversal, no row changes:

```sql
DROP TRIGGER IF EXISTS legacy_write_block ON public.sections;
DROP TRIGGER IF EXISTS legacy_write_block ON public.course_offering_sections;
DROP FUNCTION IF EXISTS public.legacy_write_blocked();
GRANT INSERT, UPDATE, DELETE ON public.sections TO authenticated;   -- only to the extent previously granted
GRANT INSERT, UPDATE, DELETE ON public.course_offering_sections TO authenticated;
```

Performed as a new approved migration; never a blind revert.

## 8. Safety statement

- This design and the migration draft mutate **no data** and apply **nothing**.
- `APPROVE_DB_MIGRATION_APPLY` is an explicit blocker; `APPROVE_LEGACY_DATA_REMEDIATION`
  gates the prerequisite A1.3b work.
- Forbidden regardless: applying to production without the gates, any backfill/cleanup,
  touching the 174 TA / 5 COS data, deploy/publish steps.
