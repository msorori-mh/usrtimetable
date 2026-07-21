# A3 — Faculty Workload Policies (source-only) + Import Simplification Inventory

- Swarm: USRTIMETABLE-AUTONOMOUS-SOURCE-CLOSURE-WAVE-03 / TRACK 4 (agent A3)
- Base: `origin/main` @ `7d738204c7824e12668d017d4c3de4f0d0af1f55` (branch point; brief referenced `b6a5a491…`, main advanced)
- Validation: **static review only** (no runtime gates in this environment; no DB writes, no migration apply, no deploy)

---

## Part 1 — Faculty workload policies (النصاب حسب الدرجة الأكاديمية)

### 1.1 What already existed (verified on main — do NOT recreate)

| Asset | Where | State |
|---|---|---|
| `public.faculty_workload_policies` (id, college_id, rank_code, rank_aliases, required_load_hours, active, timestamps, `UNIQUE(college_id, rank_code)`, RLS `can_view_college`/`can_manage_college`, updated_at trigger) | `supabase/migrations/20260716233716_73dc0ba0-…sql` (PHASE-9.3) | SOURCE ONLY / NOT APPLIED |
| `public.v_instructor_delivery_workload` (per instructor × cohort × term: `standard_assigned_hours`, `project_supervision_hours`) | 20260716233716; refreshed active-only by `20260717035611_82eaf255-…sql` (PHASE-9.4) | SOURCE ONLY / NOT APPLIED |
| `public.compute_instructor_standard_workload(instructor, term)` → status `ok/deficit/overload/unassigned/policy_missing` | 20260716233716 | SOURCE ONLY / NOT APPLIED |
| `public.preview_instructor_workload_after_assignment(...)` (read-only overload preview) | 20260717035611 (PHASE-9.4) | SOURCE ONLY / NOT APPLIED |
| Workload report UI | `src/routes/_authenticated/reports.instructor-workload.tsx` | exists |

Assigned-hours source was **verified** (not guessed): physical table is `public.teaching_assignments` (V2 columns `delivery_group_id`, `plan_course_component_id`, `cohort_id`, `assigned_component_hours`, `is_active`); there is no physical `teaching_assignments_v2` table — the V2 name is the import/runtime contract.

### 1.2 What A3 adds (`20260722110000_source_only_faculty_workload_policies.sql`, SOURCE ONLY — NOT APPLIED — gate `APPROVE_DB_MIGRATION_APPLY`)

Additive extension + hardening of the existing table (no recreate, no backfill, no seeds):

1. **Policy dimensions**: `rank_label_ar` (الدرجة الأكاديمية display label), `study_system` (انتظام/انتساب/مسائي/عن بعد; NULL = all; same value set as scheduling-headcount foundation), `min_load_hours`, `max_load_hours` (الحد الأدنى/الأعلى للنصاب), `overload_allowed` (إمكانية تجاوز النصاب), `term_id` (effective term scope, composite `(term_id, college_id)` FK per house style), `notes`.
2. **Grain change (justified)**: drop `fwp_unique` `(college_id, rank_code)` → expression unique index `fwp_college_rank_system_term_uniq` on `(college_id, rank_code, COALESCE(study_system,''), COALESCE(term_id, sentinel))` — النصاب may differ per study-system and term.
3. **Write hardening**: `REVOKE INSERT, UPDATE, DELETE ... FROM authenticated, anon, PUBLIC` (PHASE-9.3 had granted direct writes); all changes go through gated RPCs → every change is audited.
4. **RPCs** (SECURITY DEFINER, `search_path = public, pg_temp`, REVOKE from PUBLIC/anon, GRANT to authenticated/service_role):
   - `upsert_faculty_workload_policy` — manage-gated upsert on the 4-part grain, audits `faculty_workload_policy_upsert`.
   - `deactivate_faculty_workload_policy` — soft deactivate, audits `faculty_workload_policy_deactivated`.
   - `resolve_faculty_workload_policy` — rank/alias match, term → study-system specificity ordering.
   - `list_faculty_workload_assigned_hours` — read-only per-instructor aggregation from `v_instructor_delivery_workload` + resolved policy + status (`ok/deficit/overload/over_max/below_min/unassigned/policy_missing`).
   - `list_faculty_workload_overload_warnings` — warning list (`WORKLOAD_OVER_MAX`, `WORKLOAD_OVERLOAD`, `WORKLOAD_BELOW_MIN`, `WORKLOAD_DEFICIT`, `WORKLOAD_UNASSIGNED`, `POLICY_MISSING`). Advisory only — overload is a warning, never a hard write block (PHASE-9.4 doctrine).
5. **Isolation/roles**: unchanged PHASE-9.3 RLS (college isolation via `can_view_college`, manage via `can_manage_college`); all RPCs re-check the same gates.

### 1.3 Workload reports design

- Data: `list_faculty_workload_assigned_hours(college, term, study_system)` → per-instructor table (النصاب المطلوب / المسند / الحالة); warnings panel from `list_faculty_workload_overload_warnings`.
- Existing `reports.instructor-workload.tsx` is the host route for the per-instructor view; add term + study-system filters and the policy-status column set above.

### 1.4 UI implementation plan (routes/queries — mark AUTO_SAFE in a later wave)

| Item | Plan | Evidence |
|---|---|---|
| Policy management UI | New `src/routes/_authenticated/workload-policies.tsx`: list (RLS SELECT), upsert/deactivate via the new RPCs, term + study-system scoped forms (انتظام/انتساب). No dedicated route exists today (GAP). | route listing `src/routes/_authenticated/` — no workload-policies route |
| Workload report | Extend `reports.instructor-workload.tsx` to call `list_faculty_workload_assigned_hours` + warnings RPC. | existing route |
| Assignment-time preview | Reuse `preview_instructor_workload_after_assignment` in `teaching-assignments.tsx` (already wired per PHASE-9.4). | `20260717035611` |
| Policy seeds | None (user-entered per college; no invented loads). | migration header |

---

## Part 2 — Import simplification inventory

### 2.1 Binding classification

- **ACTIVE (new unified flow)** — academic_terms, full_study_plan, study_plan_courses, course_programs, instructors, rooms, daily_breaks, academic_cohorts, elective_slot_courses, cohort_elective_selections, teaching_assignments_v2.
- **UI_ONLY (managed in UI, intentionally no ImportEntity)** — university, colleges, departments, programs, scheduling settings, availability, workload policies, scheduling headcounts (evidence: `docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md` §UI-managed; routes `universities.tsx`, `colleges.tsx`, `departments.tsx`, `programs.tsx`, `scheduling-settings.tsx`, `constraint-settings.tsx`, `availability.tsx`, `scheduling-headcounts.tsx`).
- **SYSTEM_GENERATED (no import)** — course_offerings (generated from cohort curriculum; a LEGACY hidden template is retained — note below), cohort curriculum, delivery_groups, schedule_versions, schedule_sessions, conflicts.
- **LEGACY_ONLY (hidden/retained legacy templates)** — sections, course_offering_sections, teaching_assignments V1, old timetable import, **section_groups (shared lecture groups)**.

Classification discrepancies vs the binding list (flagged for lead decision):
1. `course_offerings`: binding says SYSTEM_GENERATED; repo also retains a hidden LEGACY template (`docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md` "Legacy template retained (hidden)" + `_import_apply_sections` legacy chain). Net: SYSTEM_GENERATED in new flow with a retained legacy import.
2. `shared lecture groups`: binding says SYSTEM_GENERATED; repo evidence shows `section_groups` only as a LEGACY retained template with no generator found. Classified LEGACY_ONLY per repo evidence.
3. `course_offering_sections`: no separate template/table found in this scan — treated as part of the legacy `sections` family (UNKNOWN as a distinct entity).

### 2.2 ACTIVE import capability matrix

Shared evidence (applies to all 11 ACTIVE entities unless noted):
- Template contract: `src/lib/excel-import/templates.ts`, `src/lib/excel-import/registry.ts`, `src/lib/excel-import/keys.ts` (`IMPORT_CONTRACT_VERSION 1.0.0`).
- Validation: `src/lib/excel-import/validators.ts` (blocking `unknown_column`, `duplicate_header`, `invalid_capacity`…); UI `useExcelImport`.
- Preview/manifest: `create_import_preview_manifest` + `requireImportManager` (`src/lib/excel-import/safety.ts`, migration `20260718180000_import_manifest_contract.sql`).
- Atomic commit: `commit_import_job_atomic` + `_import_dispatch` (`20260718210000_source_only_atomic_import_job_commit.sql`, SOURCE ONLY / NOT APPLIED) — single transaction, per-entity handler, college taken only from the import-job row, `import_manager_actor` substitution rejected.
- Rollback: one transaction; any mid-apply exception rolls back all rows; forced-failure proof fixture `tests/fixtures/import-atomic-commit/proof.sql`; harness `tests/harness/import-pipeline-atomic-commit.harness.ts`.
- Formula-injection protection: `src/lib/excel-import/formula-escape.ts` escapes `=`, `+`, `-`, `@` in generated template examples (export side).

| ACTIVE entity | Template | Validator | Preview | Atomic commit handler (evidence) | Duplicate handling | Rollback | Formula-injection | College isolation | Study-system isolation |
|---|---|---|---|---|---|---|---|---|---|
| academic_terms | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_table_entity` (20260718210000) | PRESENT natural-key match FOR UPDATE, mode insert/update/skip | PRESENT | PRESENT (export) | PRESENT (job-row college only) | N/A (no study-system dimension) |
| full_study_plan | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_study_plan` | PRESENT plan `(college, code)` + component upserts | PRESENT | PRESENT (export) | PRESENT | PRESENT (plan components per study-system context) |
| study_plan_courses | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_study_plan` | PRESENT | PRESENT | PRESENT (export) | PRESENT | PRESENT |
| course_programs | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_course_programs` | PRESENT | PRESENT | PRESENT (export) | PRESENT | N/A (program mapping) |
| instructors | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_table_entity` | PRESENT | PRESENT | PRESENT (export) | PRESENT | N/A (college-scoped) |
| rooms | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_table_entity` | PRESENT | PRESENT | PRESENT (export) | PRESENT | N/A |
| daily_breaks | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_table_entity` | PRESENT | PRESENT | PRESENT (export) | PRESENT | N/A |
| academic_cohorts | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_academic_cohorts` | PRESENT natural key `(program, level, study_system, entry_year, term)` | PRESENT | PRESENT (export) | PRESENT | PRESENT (study_system in natural key) |
| elective_slot_courses | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_elective_slot_courses` | PRESENT | PRESENT | PRESENT (export) | PRESENT | PRESENT (via cohort/slot scope) |
| cohort_elective_selections | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_cohort_elective_selections` | PRESENT | PRESENT | PRESENT (export) | PRESENT | PRESENT (via cohort) |
| teaching_assignments_v2 | PRESENT | PRESENT | PRESENT | PRESENT `_import_apply_teaching_assignments_v2` → `commit_teaching_assignments_v2_import` (20260717035611) — pre-validate all rows, lock delivery groups ASC, per-row audit | PRESENT natural key `(delivery_group, instructor)`; create/update/reactivate/unchanged counters | PRESENT | PRESENT (export) | PRESENT (college derived from delivery_group; can_manage per row) | PRESENT (delivery-group isolation key in `keys.ts`) |

### 2.3 GAPs / UNKNOWNs

| # | Finding | Status | Evidence |
|---|---|---|---|
| G1 | Inbound formula-injection sanitation on **import parse** (cells starting with `=+-@` in uploaded files) not verified; only export-side escaping found | UNKNOWN | `src/lib/excel-import/formula-escape.ts` (export examples only in this pass) |
| G2 | No dedicated workload-policies UI route (policy CRUD surface) | GAP | route listing `src/routes/_authenticated/` |
| G3 | `section_groups` (shared lecture groups): binding expects SYSTEM_GENERATED; only a legacy retained template found, no generator | GAP/UNKNOWN | `docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md` |
| G4 | `course_offering_sections` as a distinct entity not found; assumed legacy `sections` family | UNKNOWN | template matrix doc |
| G5 | Pre-existing: `tests/harness/teaching-assignments-v2-runtime.harness.ts` references `20260717043000_teaching_assignments_v2_runtime_foundation.sql`, absent on main (content lives in `20260717035611_82eaf255-…sql`); `run.mjs` classifies as missing-historical-artifact | GAP (pre-existing, not A3 scope) | `tests/harness/run.mjs` `historicalArtifacts` |
| G6 | All atomic-commit + workload foundations are SOURCE ONLY / NOT APPLIED; nothing is gated for apply | note | migration headers |

### 2.4 Remediation plan per GAP (proposed AUTO_SAFE)

- **G1**: add an inbound cell sanitizer in the import parse path (strip/quote leading `=`, `+`, `-`, `@` before commit), mirror the export-side escape; add harness check. AUTO_SAFE candidate (pure UI/lib change).
- **G2**: implement `workload-policies.tsx` per §1.4 (read via RLS, writes via A3 RPCs). AUTO_SAFE after A3 migration approval chain.
- **G3**: decide classification with lead; if SYSTEM_GENERATED is binding, add a generator-backed derivation of shared lecture groups and hide/remove the legacy template. Not AUTO_SAFE (needs product decision).
- **G4**: confirm whether `course_offering_sections` ever existed; if not, drop it from the binding list. Doc-only. AUTO_SAFE.
- **G5**: repoint the stale harness path (or regenerate the historical migration file). AUTO_SAFE harness fix in a separate wave.
- **G6**: no action; apply requires `APPROVE_DB_MIGRATION_APPLY`.

### 2.5 Import order / dependencies

Ground truth: `docs/IMPORT-ORDER-AND-DEPENDENCIES.md` (legacy pre-requisites) and `docs/ACADEMIC-DELIVERY-V2-IMPORT-AND-GENERATOR-01.md` (new flow: academic_terms → study plans (+ components) → course_programs → cohorts → elective slots/selections → instructors/rooms/daily_breaks → teaching_assignments_v2; generation produces cohort curriculum → course_offerings → delivery_groups → schedule versions/sessions/conflicts).
