# A1-S5 — Reports Read-Model Remediation (A1.5) — Implementation Report

- **Swarm:** USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01
- **Step:** A1-S5 (Phase A1.5 — Reports Remediation), source-only
- **Branch:** `swarm/a1-5-reports-remediation`
- **Base:** `main` @ `cbd4546886057297fee1bc8adec4eebfde729ab1`
- **Date:** 2026-07-21
- **Scope authority:** `docs/PHASE-A1-IMPLEMENTATION-PLAN.md` (A1.5), `docs/PHASE-A1-LEGACY-USAGE-INVENTORY.md` (report read surfaces), `docs/PHASE-A1-ACADEMIC-MODEL-AND-LEGACY-ISOLATION-PREFLIGHT.md` (HIGH: reports/readiness must not present Legacy/V1 data as New Flow truth)

## 1. Objective

A1.5 acceptance gate (plan gate 6): **"Cohort/DG reports use cohort/DG sources; historical section reporting remains explicitly Legacy/read-only."**

Required test posture: New Flow report does not join `sections`; golden totals/exports; tenant/system isolation; historical report unchanged/read-only.

## 2. Inventory → decision mapping (from the A1 Legacy usage inventory)

| # | Surface | Decision | Implemented |
|---|---------|----------|-------------|
| 1 | `reports.section-timetable.tsx` + `fetchSectionTimetableSessions` | HIDE_FROM_NEW_FLOW; retain historical read-only | Moved to hub `LEGACY_REPORTS` (badge `legacy`); explicit Legacy banner; head title marked Legacy; historical SELECT + headers unchanged; zero DML |
| 2 | `reports.program-level-timetable.tsx` (Legacy section selector) | REPLACE_WITH_COHORT/DG read model | Section selector replaced by **الدفعة الدراسية** (`academic_cohorts`) + **مجموعة المحاضرات/المعامل** (`delivery_groups`, cohort-cascaded); query filters `cohort_id`/`delivery_group_id` |
| 3 | `reports.published-timetable.tsx` (mixed historical) | KEEP_READ_ONLY; replace projection with cohort/DG | Still read-only published-only; inline projection now `cohort_id, delivery_group_id` (+ batched label resolution); filters replaced |
| 4 | `reports.department-schedule.tsx` | HIDE_FROM_NEW_FLOW, REMOVE_POST_LAUNCH | Already in hub Legacy group; added explicit Legacy banner (removal note); head title marked Legacy; historical projection unchanged |
| 5 | `reports.conflicts.tsx` + `operational-queries.ts` | Keep diagnostic Legacy evidence read-only | **Unchanged by design**; harness asserts the evidence column remains labeled `Legacy section` and read-only |

Additionally per the A1.5 plan file list ("report queries, mappers, filters, exports, readiness and unscheduled read models"):

- **Shared session read model** (`session-queries.ts`): `TIMETABLE_SESSION_SELECT` no longer joins `sections`; projects `cohort_id, delivery_group_id`. Historical projection preserved separately as `LEGACY_TIMETABLE_SESSION_SELECT`, used **only** by the Legacy section report.
- **Mappers/exports** (`session-mappers.ts`): rows carry `cohort`/`delivery_group`; new `NEW_FLOW_TIMETABLE_TABLE_HEADERS` (الدفعة الدراسية + مجموعة المحاضرات/المعامل) replaces the Legacy `المجموعة` column on New Flow timetable reports (instructor, room, program-level). `TIMETABLE_TABLE_HEADERS` retained byte-identical for the historical report.
- **Weekly grid** (`timetable-grid-report.tsx`): displays cohort/DG labels alongside room (Legacy `ش{section}` rendering preserved for the historical report).
- **Readiness** (`src/lib/reports/readiness.ts` + dashboard `data-readiness.tsx`): appended fail-closed New Flow metrics to the scheduling category — active cohorts without delivery groups; delivery groups without TA (V2); TA V2 without instructor (critical); sessions without cohort/DG identity (compatibility signal). Any schema gap (e.g. Phase 9.x columns not yet applied in an environment) degrades to one informational metric with zero score impact — never a crash, never stale V1 numbers presented as New Flow truth.
- **Unscheduled read model**: unchanged. It measures plan-required lecture/lab counts vs scheduled sessions (no `sections` dependency). DG-component-hour semantics (assigned_component_hours) are a **deferred follow-up** (needs the V2 requirement model, out of source-only scope for this step).

## 3. Design choice: label resolution without embeds

Cohort/DG labels are resolved by `fetchCohortDeliveryGroupLabels(collegeId, rawSessions)` — two batched, tenant-scoped `SELECT`s on `academic_cohorts(id, code)` / `delivery_groups(id, group_code)` keyed by the session FK ids. This mirrors the proven conflict-read-model evidence lookup and avoids PostgREST embeds whose FK availability cannot be statically proven in every environment (fail-closed posture, consistent with AUTO_SAFE).

Only base (Phase 9.1/9.2-era) columns are referenced: `academic_cohorts(id, code, term_id)`, `delivery_groups(id, group_code, cohort_id)`. No 9.3+ columns (`group_number`, `is_obsolete`, …) are required by reports.

## 4. Files changed

| File | Change |
|------|--------|
| `src/lib/reports/queries/session-queries.ts` | New Flow select (cohort/DG, no sections); `LEGACY_TIMETABLE_SESSION_SELECT`; cohort/DG filters on program-level + published queries; `fetchCohortDeliveryGroupLabels` |
| `src/lib/reports/session-mappers.ts` | `cohort_label`/`delivery_group_label`; `NEW_FLOW_TIMETABLE_TABLE_HEADERS`; rows carry cohort/DG; Legacy headers retained |
| `src/lib/reports/readiness.ts` | `fetchNewFlowSignals` (fail-closed) + `newFlowReadinessMetrics`; appended to scheduling category |
| `src/routes/_authenticated/reports.index.tsx` | Section timetable moved to `LEGACY_REPORTS` (badge); cohort/DG wording; Legacy group description |
| `src/routes/_authenticated/reports.section-timetable.tsx` | Explicit Legacy banner + Legacy head title (historical behavior unchanged) |
| `src/routes/_authenticated/reports.department-schedule.tsx` | Explicit Legacy banner (REMOVE_POST_LAUNCH) + Legacy head title |
| `src/routes/_authenticated/reports.program-level-timetable.tsx` | Cohort/DG selectors + filters + labels + New Flow headers |
| `src/routes/_authenticated/reports.published-timetable.tsx` | Cohort/DG projection + selectors + labels (read-only preserved) |
| `src/routes/_authenticated/reports.instructor-schedule.tsx` | Cohort/DG labels + New Flow headers (shell + grid view) |
| `src/routes/_authenticated/reports.room-timetable.tsx` | Cohort/DG labels + New Flow headers (shell + grid view) |
| `src/routes/_authenticated/data-readiness.tsx` | Same fail-closed New Flow readiness metrics on the dashboard |
| `src/components/reports/timetable-grid-report.tsx` | Cohort/DG identity in grid cells |
| `tests/harness/reports-read-model-a1-5.harness.ts` | **New** A1.5 static verification harness |
| `tests/harness/run.mjs` | Harness registered |

No migrations. No SQL. No RPC. No write paths touched. No navigation changes (hub-only reclassification; routes retained).

## 5. Validation (source-only environment)

| Gate | Result |
|------|--------|
| New harness `reports-read-model-a1-5.harness.ts` (tsx) | **PASS** |
| Regression `draft-lecturer-report.harness.ts` (tsx) | **PASS** |
| Regression `conflict-exception-reporting.harness.ts` (tsx) | **PASS** |
| esbuild syntax check — all 13 changed TS/TSX files | **PASS** |
| Static consumer sweep (mirror) | Legacy headers only used by historical report; `fetchPublishedTimetableSessions` has no other consumers; New Flow routes contain zero `sections`/`section_id` references outside explanatory comments |

Not run in this environment (same constraint as A1-S4): `tsc`, full `vite build`, full harness suite via `run.mjs` (needs the repo's locked `tsx` runtime + full `node_modules`), and runtime verification against a live Supabase project. **Must run in CI / staging before merge** — particularly a smoke test of the four New Flow report pages (instructor, room, program-level, published) confirming cohort/DG columns populate.

## 6. Safety / AUTO_SAFE statement

- Source-only; fail-closed; no production data, migration, deploy, secret, or SQL access performed or required.
- Tenant isolation preserved: every new query is `college_id`-scoped; label lookups are `college_id`-scoped.
- Historical report behavior byte-preserved (Legacy select + Legacy headers + read-only banners); rollback = revert this commit, no data impact.
- No approval gate triggered: nothing here applies migrations, executes SQL, or mutates academic data.

## 7. Observations (non-blocking, recorded for the swarm backlog)

1. `reports.instructor-workload.tsx` aggregates sessions across **all versions of a term** (`schedule_versions!inner(academic_term_id)` filter) while the hub card claims "نسخة واحدة · بدون double-count". Pre-existing inconsistency, outside A1.5 sections scope — recommend a dedicated single-version fix (A2 candidate).
2. Conflicts report displays raw cohort/DG **UUIDs** (pre-existing, PR #43). Could reuse `fetchCohortDeliveryGroupLabels` for display names in a follow-up.
3. Unscheduled report V2 semantics (delivery-group component hours vs scheduled sessions) deferred as noted in §2.

## 8. Next step (per swarm plan)

- **A1-S6:** Phase A1 closure — independent static review of A1.1–A1.5 evidence, update `docs/TIMETABLE-PROJECT-EXECUTION-STATE.md`, open the A1 closure record. A1.3b (legacy data remediation **execution**) and A1.3c (DB write-blocking trigger **apply**) remain gated on explicit owner approvals (`APPROVE_LEGACY_DATA_REMEDIATION`, `APPROVE_DB_MIGRATION_APPLY`) — no action taken here.
