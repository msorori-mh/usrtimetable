# Phase A1 — Implementation Plan

**Preflight only. No implementation is authorized by this document.**

## Locked target chain

الخطة الدراسية → الدفعة الدراسية → المقررات الاختيارية المعتمدة → مقررات الدفعة → مجموعات المحاضرات والمعامل → الإسناد التدريسي → جلسات الجدول

- `academic_cohort` = الدفعة الدراسية.
- `delivery_group` = مجموعة محاضرة أو معمل لدفعة واحدة في A1.
- `teaching_assignment` = الإسناد التدريسي.
- `sections` = Legacy only; `section_id` is not required in New Flow.
- Shared lecture groups belong to A2. Sections are forbidden as their temporary substitute.

## A1.1 — Program Department Integrity

- Files: `programs.tsx`, import registry/validators/templates, generated types, cross-college/program-department harness, a new migration later.
- Tables/RPCs: `academic_programs`, `departments`, `colleges`; program mutation authority.
- Migration: **required later** for restrictive deletion, composite same-college integrity, and possibly transactional audited RPC/grants.
- Data impact: unknown until production read-only SQL; no inferred backfill.
- Risk: HIGH for cascade deletion or invalid runtime rows.
- Dependencies: approved SQL results, explicit remediation mapping, AuthZ matrix.
- Rollback: constraint-only forward reversal before dependent writes; data remap requires reconciliation/restore, never blind rollback.
- Tests: valid/null/orphan/cross-college, read_only, college_admin own-only, direct DML/RPC, delete restriction.
- Source-only merge possible: yes after proof. Production apply required: yes, separately authorized.

## A1.2 — Legacy Navigation Isolation

- Files: `app-layout.tsx`, `/sections`, cohort/DG/TA/import routes, data-template catalog, route/terminology harnesses.
- Tables/RPCs: none changed.
- Migration/data impact: none/zero.
- Risk: MEDIUM (deep links, quick actions, downloadable Legacy templates).
- Dependencies: target IA and inventory.
- Rollback: restore route visibility/feature flag.
- Tests: sidebar and route inventory, deep-link policy, import catalog, official terminology.
- Source-only merge possible: yes. Production DB apply: no; application deploy later.

## A1.3 — Legacy Write Blocking

- Files: `/sections`, Legacy import/service callers, policies/grants/RPC migrations later, generated types, DB harness.
- Tables/RPCs: `sections`, `course_offering_sections`, section/section-group/V1 TA import helpers, direct PostgREST DML.
- Migration: **required later** to revoke/deny New Flow writes and retain an explicit maintenance/history allowlist.
- Data impact: no deletion; existing integrations/jobs must be inventoried before apply.
- Risk: HIGH because lifecycle/editor/import compatibility writes still exist.
- Dependencies: complete writer inventory and approved compatibility exceptions.
- Rollback: forward migration restoring only documented grants/policies; no row changes.
- Tests: historical SELECT allowed; INSERT/UPDATE/DELETE denied; generation leaves section/COS counts unchanged; role matrix.
- Source-only merge possible: yes after disposable-DB proof. Production apply required: yes, separately authorized.

## A1.4 — Terminology and Workflow UI

- Files: `app-layout.tsx`, `academic-cohorts.tsx`, `delivery-groups.tsx`, `teaching-assignments.tsx`, Builder UI, import/catalog labels, static harnesses.
- Tables/RPCs: normally none; validate curriculum/DG/TA V2/Builder contracts.
- Migration: no for UI; only if an RPC contract must stop consuming `section_id`.
- Data impact: zero. Risk: MEDIUM workflow regression.
- Dependencies: A1.2 IA and A1.3 isolation contract.
- Rollback: revert UI/feature configuration.
- Tests: official labels, New Flow E2E, TA/Builder with null `section_id`, regular/parallel and college isolation.
- Source-only merge possible: yes. Production apply: application deploy; RPC migration separately if needed.

## A1.5 — Reports Remediation

- Files: section/program/department/published reports; report queries, mappers, filters, exports, readiness and unscheduled read models.
- Tables/RPCs: cohorts, DGs, TA V2, sessions, versions; Legacy adapters read-only.
- Migration: none for client queries; required only for a tenant-safe view/RPC read model.
- Data impact: no writes; semantic/output impact HIGH.
- Dependencies: A1.3 semantics and production historical inventory.
- Rollback: preserve versioned Legacy historical report/adapter; revert new query/view without deleting history.
- Tests: New Flow report does not join sections; golden totals/exports; tenant/system isolation; historical report unchanged/read-only.
- Source-only merge possible: yes. Production apply: deploy; view/RPC apply separately if introduced.

## Test plan and acceptance gates

1. Program requires a same-college department; RLS/RPC/direct-DML role matrix passes.
2. No Sections in New Flow navigation or primary import catalog.
3. New Flow mutations and generators do not create sections/COS.
4. Cohort, curriculum, DG, TA V2 and Builder V2 work with `section_id = NULL`.
5. Official labels are statically enforced.
6. Cohort/DG reports use cohort/DG sources; historical section reporting remains explicitly Legacy/read-only.
7. regular/parallel and cross-college negative fixtures pass.
8. Builder, conflicts, version lifecycle, reports and exports have regression coverage.
9. Disposable PostgreSQL migration harness covers constraints, grants, RLS, RPC search paths, negative cases, concurrency and rollback.
10. TypeScript, build, lint classification, domain/admin harnesses, `git diff --check`, and scope check pass.
