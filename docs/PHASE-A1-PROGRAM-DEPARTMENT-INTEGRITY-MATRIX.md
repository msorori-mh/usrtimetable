# Phase A1 — Program/Department Integrity Matrix

**Baseline:** `a8e5c0256134d8b41aae1d3dcc8f65d534680db6`

**Scope:** read-only preflight; production values remain `UNKNOWN` until the approved read-only SQL is run.

| Area | CURRENT | GAP | TARGET | REMEDIATION | DB impact | Data risk |
| --- | --- | --- | --- | --- | --- | --- |
| Column | `academic_programs.department_id uuid NOT NULL` (`supabase/migrations/20260604225017_41baaa6b-647b-4c2f-bd10-32d352b9c8f6.sql:47-50`; generated types `src/integrations/supabase/types.ts:253-286`) | Deployed production state not observed | Every program has one department | Run production read-only checks before implementation | None in preflight | Unknown remotely; low if migration history matches runtime |
| FK | FK to `departments(id)` with `ON DELETE CASCADE` (same migration, line 50) | Department deletion can cascade through programs and descendants | Historical academic data preserved; deletion restrictive or archived | A1.1 must replace destructive cascade with RESTRICT/NO ACTION or an approved retirement model | Migration required later | **HIGH** deletion blast radius |
| Same college | `ensure_prog_college()` and `prog_check_college` reject missing/mismatched department (`20260604225017...sql:74-85`) | Latest composite hardening is source-only and cannot be assumed deployed (`20260717050000_source_only_harden_cross_college_references.sql:1-4`) | DB constraint/trigger proves `(department_id,college_id)` consistency | Validate production, then prefer composite FK backed by unique `(id,college_id)` | Migration + production apply later | Unknown until read-only SQL |
| Create/edit UI | `/programs` filters departments by active college, requires department, and writes `college_id` + `department_id` (`src/routes/_authenticated/programs.tsx:37-65,85,102-112`) | Update/delete predicate is ID-only; UI is direct DML | Same-college, tenant-explicit mutation | Add tenant predicate; decide RPC-only or transactional trigger audit | Source change; possibly migration | Low auth bypass risk because RLS remains authoritative |
| Authorization | Authenticated CRUD grant plus RLS `can_view_college`/`can_manage_college` (`20260604225017...sql:60-72`) | No program mutation RPC; audit is a separate client call | read_only denied; college_admin own college; super_admin explicit; audit atomic | Add DB/RPC tests; prefer transactional audited RPC or DB audit trigger | Migration if RPC/grants change | **MEDIUM** unaudited successful mutation |
| Imports/seeds | Programs/departments are UI-managed; import registry has no commit path (`src/lib/excel-import/registry.ts:91-103`); no repository seed for programs | Direct PostgREST DML remains exposed under RLS | One classified mutation authority | Retain UI-only classification and test direct DML | Possibly grants/RPC migration | Low in repository; unknown external clients |
| Reports | Program-level report filters via `academic_programs.department_id` (`reports.program-level-timetable.tsx:40-41`) | Department/published reports also derive department from `courses.department_id` (`reports.department-schedule.tsx:34-55`; `reports.published-timetable.tsx:56-81`) | Report dimension explicitly means program-owning or course-owning department | A1.5 must change the read model, not merely its label | Query/view change | **MEDIUM** semantic misclassification |

## Acceptance evidence required

- Accept a program with a department in the same college.
- Reject null, missing, and cross-college department references on insert and update.
- Reject read_only and cross-college college_admin direct DML/RPC calls.
- Prove department deletion cannot erase programs/history.
- Record production counts for null/orphan/cross-college rows using `C:\projects\PHASE-A1-PRODUCTION-READONLY-PREFLIGHT.sql`.

No DB write, migration apply, backfill, or production query occurred in this preflight.
