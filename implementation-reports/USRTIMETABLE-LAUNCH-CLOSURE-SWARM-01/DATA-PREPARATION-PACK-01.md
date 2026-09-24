# DATA PREPARATION PACK 01 — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01 (TRACK 9)

**Status:** `PREPARATION_ONLY — NO EXECUTION`
**Produced by:** WAVE-03 AGENT-DATA-PILOT-RELEASE (docs-only, no runtime, no DB access)
**Base:** origin/main @ `b6a5a491f9f70f1cfba5dc5696fb33f64dbcee6b`

**Absolute non-actions (this pack authorizes none of them):**
no DB writes, no backup creation, no test-data cleanup, no legacy remediation, no real-data
import, no migration apply, no pilot execution, no deploy/publish. Every executable step is
gated (see §8 and `APPROVAL-GATES.md`).

**Companion / grounding artifacts (reused, not duplicated):**

- `implementation-reports/A1-3B-LEGACY-ORPHAN-REMEDIATION-PLAN-01.md` — classification model,
  exact-IDs manifest method, backup/rollback recipes (the canonical method this pack reuses).
- `implementation-reports/A1-3B-ORPHAN-CLASSIFICATION-READONLY-01.sql` — SELECT-only
  classification + manifest generator (the only SQL allowed pre-gate).
- `implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/MIGRATION-MAP.md` — source-only
  migrations and expected apply order.
- `docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md` — official import contract v1.0.0 (column
  keys, natural keys, enums, validators).
- `src/lib/excel-import/registry.ts` — `IMPORT_CONTRACT_VERSION = 1.0.0` registry (code).
- `docs/IMPORT-ORDER-AND-DEPENDENCIES.md` — official import order.

---

## 1. Confirmed production facts (use as-is; do not re-derive without runtime evidence)

| Fact | Value | Status |
|---|---|---|
| `academic_programs` rows | 0 | CONFIRMED |
| `sections` rows | 0 | CONFIRMED |
| Orphan `teaching_assignments` (V1) carrying dangling `section_id` | 174 | CONFIRMED |
| Orphan `course_offering_sections` (COS) | 5 | CONFIRMED |
| TA V2 carrying `section_id = 0` | present (no section linkage) | CONFIRMED |
| New Flow sessions carrying `section_id = 0` | present (no section linkage) | CONFIRMED |
| Legacy classification **V1** | REJECTED — assumed `delivery_groups.course_offering_id`, which does not exist | CONFIRMED |
| Legacy relationship schema-map results (V2) | **PENDING from user** | BLOCKER |
| Pilot college id | `7168345f-cf9d-4789-b2ad-547abb687dc8` | CONFIRMED |

Reconciliation note: the A1.3b plan (§1) states TA V2 / Schedule Sessions V2 "do not carry
`section_id`", while the confirmed production observation records `section_id = 0` on those
rows. These are compatible if `0` means "no linkage" (zero/empty sentinel rather than a real
FK value), but the exact column semantics must be pinned down by the pending relationship
schema map (V2) before any classification or remediation is designed. Marked UNKNOWN in §9.

## 2. Data inventory classes

Every production row in scope is assigned exactly one class. The classification model reuses
the A1.3b priority rules (test → orphan → legacy historical → generated → real → unknown);
see A1.3b §2 for the deterministic signals and evidence columns.

| Class | Definition | Confirmed contents today |
|---|---|---|
| `test` | Rows entered for experimentation (test-marker signals: `test`, `تجريب`, `dummy`, `TEST%` on linked instructor/course). | **UNKNOWN** — no marker scan has been run; classification SQL exists (A1.3b companion) but results are not in. |
| `real` | V2 shape, valid links, no test signal; operationally valid — must never be touched by cleanup. | TA V2 and New Flow sessions are the intended real flow; full `real` census UNKNOWN until classification V2 runs. |
| `legacy` | Legacy V1 structures retained read-only for history/audit. | The 174 TA V1 rows + 5 COS rows are Legacy-surface; their subclass (orphan vs legacy historical) awaits schema map V2. |
| `orphan` | Dangling references (e.g., `section_id` with no `sections` row — guaranteed since `sections` = 0). | 174 TA V1 (dangling `section_id`) CONFIRMED structurally; 5 COS CONFIRMED structurally. |
| `unknown` | No rule matches, or facts not yet verified. | Everything not listed as CONFIRMED in §1; includes the `section_id = 0` semantics on V2 rows. |

Explicitly unverified (kept UNKNOWN, not guessed):

- Row counts and contents of all other academic tables (courses, departments, study_plans,
  cohorts, instructors, rooms, terms, delivery_groups, schedule_versions, etc.).
- Whether any test data exists in V2/New Flow tables.
- Reference scans (`schedule_sessions`, `section_group_members` referencing the 174+5) —
  queries exist in the A1.3b companion SQL §5 but results are pending.

## 3. Backup plan (design only — execution gated)

Naming convention (repo precedent, from A1.3b §3):

```
public.zz_backup_<task_tag>_<table>_<yyyymmdd>
```

- `zz_backup_` prefix sorts last and is unambiguous (precedent:
  `zz_backup_a1_3b_teaching_assignments_20260721`, `zz_backup_a1_3b_course_offering_sections_20260721`).
- `<task_tag>` ties the backup to its manifest (e.g., `a1_3b`, `test_cleanup_01`).
- Backups are created **only inside an approved execution window** — never "just in case".

Creation pattern (template — gated, not to run):

```sql
CREATE TABLE public.zz_backup_<tag>_<table>_<yyyymmdd> AS
SELECT * FROM public.<table>
WHERE id IN (SELECT id FROM <exact-IDs manifest for that table/class>);
```

Backup acceptance checks (must pass before any mutating statement; from A1.3b §3):

1. Backup row count equals manifest row count per table.
2. Backup row-content checksum equals the pre-change manifest checksum
   (`md5(concat_ws('|', key columns))` per row, aggregated `md5(string_agg(... ORDER BY id))`).
3. Backup table is readable and restorable (spot-restore one row into a temp table).

Retention:

- Backups live until the dependent remediation/cleanup is verified AND any dependent
  hardening migration (e.g., A1.3c `20260721090000_source_only_legacy_write_hardening.sql`)
  is applied, plus a quiet window (A1.3b precedent: 7 days) with no rollback request.
- Dropping a backup table is itself a gated action, recorded in the execution log.

Verification: global checksums per table (`md5(string_agg(id::text || ':' || classification,
',' ORDER BY id))`) computed before, during dry-run, after rollback, and after real execution;
all transitions must match the expected model exactly.

## 4. Cleanup manifest METHOD (template only — NO actual cleanup)

**Gate: `APPROVE_TEST_DATA_CLEANUP` (PENDING).** Nothing in this section may execute without it.

Method (reused from A1.3b §4–§8, generalized to test/generated data):

1. **Classification run (read-only).** Run SELECT-only classification SQL; emit one row per
   candidate: `table_name, id, classification, signals (jsonb), row_checksum`.
2. **Exact-IDs manifest.** Persist the manifest (`<TAG>-MANIFEST-<date>.csv`). The manifest is
   the ONLY allowed driver of cleanup: every mutating statement must filter
   `WHERE id IN (<manifest ids>)` — no predicate re-derivation at execution time.
3. **Dependency graph.** For each manifest table, enumerate inbound references (FK children,
   read-model/report consumers, RLS-scoped tenants) before choosing delete vs keep. Template
   dependency checklist: `schedule_sessions`, `section_group_members`, delivery/curriculum
   generators, report read models, published-schedule snapshots.
4. **Human confirmation.** Class `test` requires explicit owner confirmation of test origin;
   class `unknown` aborts the batch entirely.
5. **Backup.** Create `zz_backup_*` tables for the manifest IDs; run the 3 acceptance checks (§3).
6. **Dry-run.** `BEGIN;` → execute deletes filtered by manifest IDs → re-run classification →
   expected post-state verified → `ROLLBACK;` → confirm DB byte-identical via global checksums.
7. **Execution (only after dry-run evidence is recorded).** Same statements, same transaction
   discipline, audit counts captured (rows deleted per table/class).
8. **Rollback.** Restore from `zz_backup_*` filtered by manifest IDs; post-rollback checksums
   must equal the before-checksums exactly.

Deliverables when the gate opens: manifest CSV(s), dry-run evidence (counts + checksums +
timestamps), execution log, rollback verification record.

## 5. The 174 TA V1 + 5 COS handling — HARD GATE

- These rows are governed by the A1.3b plan and its gate
  **`APPROVE_LEGACY_DATA_REMEDIATION` (PENDING)**. This pack proposes **no action** on them.
- Legacy classification **V1 was REJECTED** (it assumed `delivery_groups.course_offering_id`,
  a column that does not exist). Classification **V2** cannot be designed until the user's
  **relationship schema-map results** arrive.
- Therefore: **do not touch the 174 TA + 5 COS before classification V2 exists and is
  approved.** No nullify, no delete, no backfill, no "quick fix" — regardless of how safe a
  statement looks, the structural classification itself is not yet trustworthy.
- Once the schema map lands: re-run the A1.3b SELECT-only classification, regenerate the
  exact-IDs manifest, and re-present the remediation options (A1.3b §5: recommended nullify
  TA `section_id` + delete 5 COS) for gate decision.
- Sequencing constraint (from MIGRATION-MAP): A1.3c legacy write-hardening migration
  (`20260721090000`) applies only AFTER legacy remediation completes and is verified.

## 6. Real import files specification — per ACTIVE entity

**Gate: `APPROVE_REAL_DATA_IMPORT` (PENDING).**
Source of truth: import contract v1.0.0 (`docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md`,
registry `src/lib/excel-import/registry.ts`).

Common contract (applies to all 11 active entities):

- **Format:** `.xlsx` generated at runtime by the template generator
  (`scripts/generate-final-import-templates.ts`); no `.xlsx` files are committed to Git.
  Filename convention via `suggestedTemplateFilename`. Each workbook carries a Metadata sheet
  (`contract_version`, `generated_at`, `entity_key`). English column keys are contractual;
  Arabic headers are display-only.
- **Commit path:** preview via `requireImportManager` (college-scoped) → atomic commit via
  `commit_import_job_atomic` (job_id only; stored payload authoritative). No client DML.
- **Blocking validations:** `missing_required`, `unknown_column` (unknown header rejected),
  `duplicate_header`, `invalid_enum`, `invalid_capacity` (capacity ≤ 0 rejected), type errors.
- **Common normalizations:** trim; `toBool` accepts true/false/1/0/نعم/لا; times as `HH:MM`;
  `days` as CSV `0..6` (0 = Sunday).
- **Pilot enum restrictions:** `study_system` ∈ {regular, parallel} (schema allows more —
  templates restrict); `component_type` ∈ {theory, practical, tutorial, project}
  (`summer_training` forbidden at validate + RPC).
- **Not importable by design:** `delivery_groups`, `cohort_curriculum`, `course_offerings`
  (new flow), `schedule_versions`/`schedule_sessions` (GENERATED_NOT_IMPORTED);
  `instructor_availability`, `time_slot_templates`, `faculty_workload_policies`,
  colleges/departments/programs (UI_MANAGED_NOT_IMPORTED).
- **Legacy-only templates** (sections, course_offerings, teaching_assignments V1,
  section_groups) are hidden from the new UI — not part of the real import.

| # | Entity | Sheet | Natural key | Required columns | Key validations / references |
|---|---|---|---|---|---|
| 1 | `academic_terms` | terms | `code` | code, name | term_type ∈ {first, second}; dates ISO; teaching_weeks_count number |
| 2 | `instructors` | instructors | `employee_number` | employee_number, full_name | employment_type ∈ {full_time, part_time, visiting}; department_code → departments.code |
| 3 | `rooms` | rooms | `code` | code, name, capacity, room_type | room_type ∈ official enum (lecture_hall, computer_lab, network_lab, cybersecurity_lab, electronics_lab, workshop, seminar_room); capacity > 0 |
| 4 | `daily_breaks` | daily_breaks | `name` | name, start_time, end_time, days | days CSV 0..6; HH:MM times |
| 5 | `full_study_plan` | full_plan | composite: plan + course | program_code, plan_code, level_number, semester, department_code, course_code, course_name, credit_hours | program_code → academic_programs.code; elective slot codes → elective_slots.slot_code; course_nature ∈ {department, faculty, university} |
| 6 | `study_plan_courses` | plan_courses | composite: plan + course | same required set as full_study_plan (level/semester scoped variant) | same references as #5 |
| 7 | `course_programs` | course_programs | composite: course + program | course_code, program_code | shared-course linkage; course_code → courses.code, program_code → academic_programs.code |
| 8 | `academic_cohorts` | academic_cohorts | composite: program + level + study_system + entry_year + term | program_code, level_number, study_system, entry_year, term_code | study_system ∈ {regular, parallel} (Pilot); term_code → academic_terms.code; count_status ∈ {estimated, confirmed, locked} |
| 9 | `elective_slot_courses` | elective_slot_courses | composite: plan + slot + course | program_code, plan_code, elective_slot_code, course_code | slot → elective_slots.slot_code; course → courses.code |
| 10 | `cohort_elective_selections` | cohort_elective_selections | composite: cohort + slot | cohort_code, elective_slot_code, selected_course_code | cohort_code → academic_cohorts.code; selected course must belong to the slot |
| 11 | `teaching_assignments_v2` | assignments_v2 | composite: cohort + course + component + group + instructor | cohort_code, course_code, component_type, delivery_group_code, employee_number | delivery_group_code → delivery_groups.group_code (groups are GENERATED first); component_type Pilot enum; required_room_type ∈ room_type enum |

Official import order: per `docs/IMPORT-ORDER-AND-DEPENDENCIES.md` (foundation entities first;
cohorts before elective selections before TA V2; `delivery_groups` must be generated via
`generate_cohort_delivery_groups` before TA V2 import can resolve `delivery_group_code`).

Pre-import readiness checklist (blocks the gate review):

1. Templates regenerated from registry v1.0.0 (fresh `contract_version`/`generated_at`).
2. Pilot college/department/program exist via UI foundation (not importable).
3. Foundation rows (terms, rooms, instructors, breaks) validated clean in preview.
4. Study plan + cohorts imported; `generate_cohort_delivery_groups` +
   `generate_cohort_curriculum` run; only then TA V2.
5. Every commit dry-run (preview) error count = 0 before atomic commit.

## 7. Sequencing with migrations and legacy work

From MIGRATION-MAP (all gated by `APPROVE_DB_MIGRATION_APPLY`, PENDING):

1. `20260717050000` (cross-college composite keys) → prerequisite for headcount.
2. `20260720143000` (program/department integrity) — when need/order confirmed.
3. `20260721180000` (scheduling headcount foundation) → then approved cohort headcounts.
4. `20260721090000` (legacy write hardening) — ONLY after legacy remediation (§5) completes.

Data preparation must be planned against this order: real import and headcount inserts cannot
be considered production-ready until the prerequisite migrations are applied and evidenced.

## 8. Gates touched by this pack (all PENDING — see APPROVAL-GATES.md)

| Gate | Unlocks |
|---|---|
| `APPROVE_TEST_DATA_CLEANUP` | §4 manifest-driven test-data cleanup (backup → dry-run → execute) |
| `APPROVE_LEGACY_DATA_REMEDIATION` | §5 — 174 TA + 5 COS remediation after classification V2 |
| `APPROVE_REAL_DATA_IMPORT` | §6 — real import preview + atomic commits |
| `APPROVE_DB_MIGRATION_APPLY` | §7 — migration chain the data plan depends on |

## 9. UNKNOWNs register (explicit — do not guess)

1. Relationship schema-map results (V2) — **pending from user**; blocks §5 and final
   classification of 174 TA + 5 COS.
2. Semantics of `section_id = 0` on TA V2 / New Flow sessions (sentinel vs column artifact) —
   reconcile with A1.3b §1 statement that V2 does not carry `section_id`.
3. Full-table census of test/real/legacy classes outside the 174+5 scope.
4. Reference scan results (schedule_sessions / section_group_members → 174+5).
5. Whether any production college besides the pilot college
   (`7168345f-cf9d-4789-b2ad-547abb687dc8`) holds data in scope.
6. `created_at`/audit provenance availability for time-based class splits (A1.3b open q1).
7. Test-marker list confirmation with domain owner (A1.3b open q2).
