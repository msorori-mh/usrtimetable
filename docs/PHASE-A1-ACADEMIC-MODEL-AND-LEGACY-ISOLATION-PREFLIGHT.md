# Phase A1 — Academic Model and Legacy Isolation Preflight

**Phase:** `PHASE-A1-ACADEMIC-MODEL-AND-LEGACY-ISOLATION-PREFLIGHT-01`

**Decision:** `PASS_WITH_FINDINGS — PHASE_A1_PREFLIGHT_COMPLETE`

**Baseline:** `a8e5c0256134d8b41aae1d3dcc8f65d534680db6`

**Production implementation status:** HOLD pending user review, approved production read-only evidence, and separately authorized implementation.

## Scope and evidence boundary

This preflight inspected source, migrations, generated types, UI/routes, services, reports, static harnesses and existing documentation. It made no product-source or migration change, performed no database write or migration apply, and did not query production. Runtime counts therefore remain `UNKNOWN`.

G0 passed: clean worktree, correct branch, and `HEAD = origin/main = a8e5c025...` at start.

## Target model

الخطة الدراسية → الدفعة الدراسية → المقررات الاختيارية المعتمدة → مقررات الدفعة → مجموعات المحاضرات والمعامل → الإسناد التدريسي → جلسات الجدول

`academic_cohort` is the student academic set. `delivery_group` represents one lecture/lab group for one cohort in A1. `teaching_assignment` is authoritative teaching allocation. Sections are Legacy-only. Shared delivery is deferred to A2 and must never be implemented through sections.

## Executive findings

### Program/department

The source contract already declares `academic_programs.department_id NOT NULL`, references `departments(id)`, and runs `ensure_prog_college()` to reject missing or cross-college departments (`20260604225017_...sql:47-50,74-85`). The programs UI requires a department and filters departments to the active college (`programs.tsx:37-65`). RLS denies read_only mutation and confines college_admin through `can_manage_college`.

Findings: the FK cascades department deletion into programs; client audit is not atomic with direct DML; some reports confuse program-owning and course-owning department; composite hardening migrations are source-only and not proof of production state.

### Legacy isolation

Inventory found **798 matching lines in 124 files**, **9 user-facing route files with textual references (7 operational)**, **8 logical write paths**, and **5 direct report surfaces**. `/sections` remains in primary navigation with CRUD. Authenticated managers also retain direct table writes to `sections` and `course_offering_sections`. Import helpers, timetable editing, greedy scheduling and lifecycle cloning can create or propagate Legacy identifiers.

### New Flow dependence

- Cohorts and curriculum generation do not require or create sections/COS.
- DG generation is cohort/component based and does not require `section_id`.
- TA V2 creates through DG and leaves `section_id` null.
- Builder V2 does not require a non-null section, but still passes a TA `section_id` to conflict/session writes when present (`20260717093000...sql:632,700,718,1072,1285`). It needs an explicit null-section harness and later removal of compatibility consumption from the V2 path.

### Authorization/isolation

V2 RPCs authenticate and call `can_manage_college`; read_only is denied and college_admin is tenant-scoped. Curriculum hardening uses a strict `pg_catalog,public,pg_temp` search path; other V2 RPCs use fixed `public`. regular/parallel checks exist in curriculum, DG, TA and Builder queries. However, direct CRUD grants on DG/TA and Legacy tables leave additional mutation authorities, and source-only composite FKs cannot be treated as deployed evidence.

### UI, terminology and reports

The shipped UI uses inconsistent labels such as «الدفعات الأكاديمية» and «مجموعات التدريس» and exposes `/sections`. `/data-templates` can still show downloadable Legacy templates. Section/program/published/department reports read Legacy sections; readiness still measures V1 TA columns. These require read-model remediation, not cosmetic renaming.

## BLOCKER/HIGH register

| Severity | Finding | Evidence/decision |
| --- | --- | --- |
| BLOCKER | `/sections` is visible and mutable | `app-layout.tsx:136`; `sections.tsx::save/deleteMutation`; remove from New Flow and block DB writes |
| BLOCKER | Import helpers can create sections/section groups/V1 section-linked TA | `20260718210000_source_only_atomic_import_job_commit.sql`; revoke New Flow reachability |
| HIGH | `sections` and `course_offering_sections` have authenticated direct CRUD under RLS | `20260604225017...sql:311-323`; `20260605001512...sql:198-210`; DB-level block required |
| HIGH | Timetable editor/scheduler/lifecycle write or propagate `section_id` | `session-dialog.tsx`, `greedy.ts`, `lifecycle.ts`; replace with DG identity |
| HIGH | Builder V2 still consumes compatibility `section_id` | Must prove null operation and remove consumption from V2 |
| HIGH | Department FK cascades deletion into programs/history | Change to restrictive/retirement semantics in A1.1 |
| HIGH | Reports/readiness can present Legacy/V1 data as New Flow truth | A1.5 must use cohort/DG/TA V2 read models |
| HIGH | Production state and source-only hardening deployment are unknown | Run approved read-only SQL; do not infer counts |

## Acceptance gates status

| Gate | Preflight conclusion |
| --- | --- |
| Program has department / same college | Source contract PASS; production evidence PENDING |
| No Sections in New Flow navigation | FAIL today; A1.2 required |
| No New Flow Legacy mutations | FAIL today; A1.3 required |
| No required `section_id` in cohort/DG/TA/Builder | Cohort/DG/TA PASS by source; Builder conditional compatibility finding |
| Official terminology | FAIL today; A1.4 required |
| Cohort/DG reports independent of sections | FAIL today; A1.5 required |
| Legacy read-only | FAIL today; DB grants/policies allow manager writes |
| AuthZ/RLS/RPC tests | Partial existing coverage; explicit A1 matrix required |
| regular/parallel and cross-college isolation | Source controls present; production and negative tests pending |
| Builder/lifecycle regression | Existing harnesses available; A1-specific null-section/regression tests pending |

## Data and migration posture

No recent documented production counts exist for sections, COS, null/orphan programs, or cross-college program/department rows. Historical term-remediation fixture counts are not current production evidence and are not reused as such.

The SELECT-only file `C:\projects\PHASE-A1-PRODUCTION-READONLY-PREFLIGHT.sql` records environment identity, program/department anomalies, Legacy counts, every `section_id` schema reference, New Flow rows carrying Legacy IDs, historical version linkage, and deployed constraints. It was created outside Git and not executed.

Later implementation requires migrations for A1.1 integrity/deletion/audit decisions and A1.3 grants/RLS/RPC write blocking. A1.2 and most of A1.4 are source-only. A1.5 may be source-only unless a secure read view/RPC is selected.

## Next step

`USER REVIEW OF PHASE A1 IMPLEMENTATION PLAN.`
