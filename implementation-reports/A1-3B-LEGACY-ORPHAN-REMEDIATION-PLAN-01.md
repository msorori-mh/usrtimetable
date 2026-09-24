# A1.3b — Legacy Orphan Remediation Plan (DESIGN ONLY — NO EXECUTION)

**Status:** `DESIGN_ONLY — EXECUTION FORBIDDEN`
**Execution gate:** `APPROVE_LEGACY_DATA_REMEDIATION` — nothing in this plan may be executed
(including the backup CTAS statements) without this explicit approval. The companion
A1.3c migration additionally requires `APPROVE_DB_MIGRATION_APPLY`.

**Companion artifacts:**

- `implementation-reports/A1-3B-ORPHAN-CLASSIFICATION-READONLY-01.sql` — SELECT-only
  classification + exact-IDs manifest generator. It contains **no** INSERT/UPDATE/DELETE/
  DDL and is the only SQL allowed to run before the gate.
- `implementation-reports/A1-3C-LEGACY-DB-HARDENING-DESIGN-01.md` — DB hardening design
  that must be applied **after** this remediation.
- `supabase/migrations/20260721090000_source_only_legacy_write_hardening.sql` — source-only
  hardening draft (NOT APPLIED).

## 1. Scope and production facts (as provided by the A1 coordination context)

| Table | Rows in scope | Fact |
| --- | --- | --- |
| `sections` | 0 | Empty in production. |
| `course_offering_sections` (COS) | 5 | All 5 are orphans (their `section_id` dangles because `sections` is empty; offering linkage must be verified by the read-only SQL). |
| `teaching_assignments` with `section_id` | 174 | All 174 carry a `section_id` that dangles (no matching `sections` row). |
| `academic_programs` | 0 | Empty in production (context only). |
| TA V2 / Schedule Sessions V2 | — | Do **not** carry `section_id`; out of remediation scope. |

Scope decisions honored: `sections`, `course_offering_sections`, and TA V1 are Legacy only;
no New Flow uses `section_id`; the study plan is the source of cohort courses;
`delivery_groups` = مجموعات المحاضرات والمعامل.

## 2. Row classification model

Every one of the 174 TA rows and 5 COS rows receives exactly one class, derived from
deterministic, reproducible signals (no manual tagging). Priority order (first match wins):

| # | Class | Rule (evaluated in order) | Meaning |
| --- | --- | --- | --- |
| 1 | `test` | Test-marker signal: linked instructor name or course code matches test patterns (`test`, `تجريب`, `dummy`, `TEST%`). | Data entered for experimentation; deletion candidate after owner confirmation. |
| 2 | `orphan` | `section_id IS NOT NULL` with no matching `sections.id` (dangling), **or** `course_offering_id` with no matching `course_offerings.id`. | Structurally dangling Legacy reference. Expected class for all 174 TA + most/all 5 COS. |
| 3 | `legacy historical` | Legacy V1 shape (`section_id IS NOT NULL` **or** `delivery_group_id IS NULL`) with all references intact. | Historically meaningful V1 rows kept read-only for audit. |
| 4 | `generated` | Reserved: rows attributable to a system generation RPC. Not currently detectable on TA/COS (no source marker column) — documented so no row is silently forced into it. | Would require an explicit source marker; none exists. |
| 5 | `real` | V2 shape (`delivery_group_id IS NOT NULL`, `section_id IS NULL`) with valid links and no test signal. | Operationally valid rows — must be kept untouched. Not expected inside the 174+5 scope. |
| 6 | `unknown` | Fallback when no rule matches. | Requires human review before any action. |

Each row also emits independent boolean evidence signals (`has_dangling_section`,
`has_dangling_offering`, `legacy_shape`, `v2_shape`, `test_signal`) so reviewers can audit
why a class was assigned.

## 3. Backup plan (execution-time only — post-gate)

Backup tables (created only during the approved execution window, never before):

- `public.zz_backup_a1_3b_teaching_assignments_20260721`
- `public.zz_backup_a1_3b_course_offering_sections_20260721`

Naming rationale: `zz_backup_` prefix sorts last and is unambiguous; `a1_3b` ties the backup
to this task; `20260721` is the plan date (aligned with the A1.3c migration timestamp).
Creation pattern (illustrative — gated, not to run now):

```sql
CREATE TABLE public.zz_backup_a1_3b_teaching_assignments_20260721 AS
SELECT * FROM public.teaching_assignments
WHERE id IN (SELECT id FROM <exact-IDs manifest for teaching_assignments>);
```

Backup acceptance checks (must pass before any remediation statement):

1. Backup row count equals manifest row count per table.
2. Backup checksum (same md5 recipe as the manifest) equals the pre-change manifest checksum.
3. Backup table is readable and restorable (spot-restore one row into a temp table).

## 4. Exact-IDs manifest method

The read-only SQL companion generates the manifest as a deterministic result set:
`table_name, id, classification, signals (jsonb), row_checksum` where
`row_checksum = md5(concat_ws('|', id, section_id, course_offering_id, instructor_id, ...))`
per table, ordered by `id`. It also emits a **global checksum**
(`md5(string_agg(id || ':' || classification, ',' ORDER BY id))` per table) so the exact
same set can be re-verified bit-for-bit before and after remediation.

The manifest is the **only** allowed driver of remediation: every mutating statement (when
ever approved) must filter `WHERE id IN (<manifest ids for that table/class>)` — no
predicate-based re-derivation at execution time.

## 5. Remediation action options (decision required at the gate)

| Class | Option A (recommended) | Option B | Notes |
| --- | --- | --- | --- |
| `orphan` TA (174) | **Nullify `section_id`** (`UPDATE ... SET section_id = NULL WHERE id IN (manifest)`). Preserves the TA row as legacy history; zero data loss; removes the dangling reference that blocks A1.3c hardening. | Delete the row (only if also unreferenced by schedule_sessions/section_group_members — reference scan in SQL §5). | Deletion is irreversible without the backup; nullify-first keeps a second chance. |
| `orphan` COS (5) | Delete the 5 join rows after backup (join rows to a nonexistent section carry no history value). | Nullify `section_id` if the offering link is valid and worth keeping. | 5 rows only; trivially reviewable in the manifest. |
| `test` | Delete after explicit owner confirmation of test origin. | Keep (no marker column today → prefer delete-or-keep decision). | Requires human confirmation; never auto-delete. |
| `legacy historical` | Keep as-is (read-only history). | — | Preflight decision: historical Legacy data remains intact and readable. |
| `real` | Keep untouched. | — | Outside the 174+5 scope by construction. |
| `unknown` | Block remediation; human review. | — | Any `unknown` row aborts the execution batch. |
| `generated` | Not applicable today. | — | Reserved class. |

Recommended composite: **nullify TA `section_id` (174) + delete the 5 COS orphans**, the
minimal change that unblocks A1.3c write-blocking triggers without losing history.

## 6. Dry-run procedure (post-gate, pre-execution)

1. Run `A1-3B-ORPHAN-CLASSIFICATION-READONLY-01.sql` end-to-end; save the manifest output
   (CSV) as `A1-3B-MANIFEST-<date>.csv`. Expected: 174 TA rows, 5 COS rows, 0 `unknown`.
2. `BEGIN;`
3. Create the two backup tables (§3); run the three backup acceptance checks.
4. Execute the approved remediation statements filtered strictly by manifest IDs.
5. Re-run the classification queries inside the same transaction: expected post-state —
   TA `orphan` count = 0 (`section_id` nullified) or 174 rows gone (delete option);
   COS = 0 rows.
6. Compute after-checksums and compare with the expected model; capture audit counts
   (rows updated/deleted per table).
7. `ROLLBACK;` — the dry run must leave the database byte-identical (verify with the
   pre-state global checksums re-computed after rollback).
8. Record dry-run evidence (counts + checksums + timestamps) in the execution log.

## 7. Checksums (before/after)

| Checksum | Recipe | Compared |
| --- | --- | --- |
| Row counts | `count(*)` per table per classification | before vs expected after |
| Manifest checksum | `md5(string_agg(id::text || ':' || classification, ',' ORDER BY id))` per table | before vs dry-run-after vs post-rollback |
| Row content checksum | per-row `md5(concat_ws('|', key columns))`, aggregated as `md5(string_agg(... ORDER BY id))` | backup vs live before remediation; backup vs restored after any rollback |
| Reference scan | counts of schedule_sessions/section_group_members referencing the manifest IDs | must be known before choosing the delete option |

## 8. Rollback plan

- Rollback driver = the backup tables + the manifest (never a blind restore).
- For **nullify** remediation: restore original `section_id` values with
  `UPDATE t SET section_id = b.section_id FROM zz_backup_a1_3b_teaching_assignments_20260721 b WHERE t.id = b.id AND t.id IN (manifest ids)`.
- For **delete** remediation: `INSERT INTO ... SELECT * FROM zz_backup_... WHERE id IN (manifest ids)`.
- Post-rollback verification: global checksums must equal the **before** checksums exactly;
  classification counts must equal the before counts.
- Backups are dropped only after the A1.3c hardening is applied and a post-apply window
  (suggested: 7 days) passes with no rollback request. Backup drop itself is a gated action.

## 9. Execution gate (explicit blocker)

- `APPROVE_LEGACY_DATA_REMEDIATION` — required for: backup creation, dry-run steps 2–8,
  and any mutating statement. Without it, only the information-schema preflight (§1 of the
  SQL companion) and the SELECT-only classification/manifest may run.
- `APPROVE_DB_MIGRATION_APPLY` — additionally required to apply the A1.3c hardening
  migration, which must happen **after** this remediation completes and is verified.
- Forbidden regardless of gates: touching the 174 TA / 5 COS data before the gate,
  any backfill/cleanup outside the manifest, any deploy/publish step.

## 10. Open questions for the gate reviewer

1. Confirm `created_at`/audit provenance availability for a time-based split (would sharpen
   `legacy historical` vs `real`); the current model is structure-based and needs none.
2. Confirm the test-marker list (§2 #1) with the domain owner before class `test` is actionable.
3. Choose the remediation option per class (§5) — recommended: nullify TA + delete 5 COS.
