# University Timetable Platform — Execution State

Updated: 2026-07-18 (Asia/Riyadh), next-agent-wave initialization

## Repository state

- Repository: `msorori-mh/usrtimetable`
- Main worktree: `C:\projects\usrtimetable-mainline`
- Local `main`: `8ef4226c06fbf5d45aca83212065f46f7c1de325` (28 commits behind)
- `origin/main`: `df0dad52155c06bef987439bbd5ab2ae86ca232f`
- Autopilot worktree: `C:\projects\usrtimetable-autopilot`
- Autopilot branch: `codex/timetable-autopilot-state`
- Security hardening worktree: `C:\projects\usrtimetable-security-hardening`
- Security hardening branch: `codex/cross-college-reference-integrity`
- Typecheck worktree: `C:\projects\usrtimetable-typecheck`
- Typecheck branch: `codex/typecheck-implicit-any`
- Main worktree is preserved dirty: modified `src/routeTree.gen.ts`; untracked `implementation-reports/`.
- Phase 9.5 worktree is preserved dirty with four untracked implementation files.

## Pull requests and CI

- Open PR #30: `feat/phase-9-2-academic-delivery-model-v2-import-generator`; status `CONFLICTING/DIRTY`; no checks.
- PR #35 merged as `f77277d6e7c62e11c5211d9c0b3dcf938dea3da5`: durable autopilot state and non-semantic SQL comment repair.
- PR #34 merged as `7494b37124a5e8028f7d6eca8dd1ca2c82fb1532`: implicit-any TypeScript fixes.
- PR #33 merged source-only as `5c20ea69b7556dc417ee1bcfdc16b26712baf8b8`: cross-college reference-integrity hardening.
- Recent merged PRs: #32 (Phase 9.4), #31 (Phase 9.3), #29 (Phase 9.2).
- GitHub Actions: no workflows and no runs were found. CI status: `NOT_CONFIGURED`.

## Capability inventory

| Area | Status | Evidence / next action |
| --- | --- | --- |
| Schedule builder | COMPLETE | Phase 9.5 assignment integration merged as PR #37; production migration remains unapplied. |
| Version lifecycle | COMPLETE_SOURCE_ONLY | PR #42 merged as `a1862a8`; atomic revision-bound quality evidence, authorization, audit, concurrency and publish blockers passed disposable PostgreSQL and independent review. Migration is not applied. |
| Curriculum/cohorts | COMPLETE | PR #41 merged as `99bd0b2`; cohort-first context and default-deny Legacy section adapter passed independent review. |
| Offerings/assignments | REVIEW | CRUD and dependency hardening exist; CRUD policy requires an authoritative decision; generation is missing. |
| Imports | REVIEW | Preview/validate/commit framework exists; broad entity, authorization and rollback coverage is missing. |
| Conflicts | COMPLETE | PR #43 merged as `75e346e`; hard blockers, warnings, approved exceptions and stale/unknown evidence are separated with tenant and study-system isolation. |
| Reports | COMPLETE | Draft lecturer schedule regression and shared version-scoped reporting merged as PR #39. |
| Security/isolation | COMPLETE | Source-only composite-FK hardening for 21 cross-college references was verified on disposable PostgreSQL and merged; production apply remains separately gated. |

## Migrations and runtime

- 94 migration files are present; 15 are marked source-only/do-not-auto-apply.
- Applied/pending status cannot be proven: Supabase CLI/admin credentials are unavailable.
- Runtime status: `UNKNOWN`; production status: `UNCHANGED`.
- No migration, SQL, deployment, publish, or production write was performed.
- Duplicate migration chains and source-only reset/remediation files require reconciliation before any apply plan.
- Highest security finding: tenant-scoped foreign keys generally reference IDs alone and do not prove referenced rows share the same `college_id`.
- First safe fix completed and independently reviewed: repaired the malformed SQL comment in `20260715200200_harden_course_offering_term_references.sql`; no DDL/DML semantics changed.

## Queue

1. `COMPLETE` — malformed source-only SQL comment repaired; independent review and `git diff --check` passed.
2. `COMPLETE` — PR #33 merged source-only after disposable PostgreSQL and final security review passed.
3. `COMPLETE` — instructor draft schedule/zero-value regression merged as PR #39.
4. `COMPLETE` — PR #34 merged; TypeScript passes.
5. `COMPLETE` — Phase 9.5 Schedule Builder V2 assignment integration merged as PR #37.
6. `COMPLETE_SOURCE_ONLY` — atomic schedule-version lifecycle and authorization hardening merged as PR #42; production migration apply remains gated.
7. `COMPLETE` — study-plan/cohort alignment and Legacy-section transition map merged as PR #41.
8. `COMPLETE` — conflict/exception reporting evidence and isolation hardening merged as PR #43.
9. `BLOCKED` — PR #30 remains conflicting and isolated.
10. `REQUIRES_USER_APPROVAL` — production application of any source-only migration, or any deploy/publish action.

## Binding academic decision

- Approved study plans define core cohort courses by level and semester; there is no free individual core-course registration in timetable operations.
- Approved electives are cohort-level academic decisions.
- `academic_cohort` is authoritative for students; `delivery_groups` split teaching components only for capacity or delivery nature.
- Sections are absent from the new operating model. `sections` and `course_offering_sections` are Legacy-only compatibility structures, and new `section_id` dependencies require explicit compatibility documentation.
- `regular` and `parallel` are strictly isolated.

## Quality gates

- Independent migration review: `PASS`.
- `git diff --check`: `PASS`.
- Dependency installation ultimately completed successfully and produced a valid untracked lockfile. The harness runner still blocks because `tsx` is not a declared dependency and uses synchronous `npx`; direct Bun execution is the reliable local path.
- Harness baseline via Bun: 21 passed; 3 pre-existing contract failures were isolated (`course-offering-dependency-fk`, `experimental-schedule-reset-room-integrity`, `teaching-assignments-v2-runtime`) because their expected reports/migrations are absent from `origin/main` but exist in other active worktrees.
- Build: `PASS`.
- TypeScript: `PASS` after PR #34.
- Lint: `BASELINE_FAIL`, dominated by repository-wide CRLF/Prettier findings; no formatting sweep was performed.
- Security PR #33: disposable PostgreSQL 15, targeted harness, TypeScript, build, scoped lint, `git diff --check`, and final independent security review all `PASS`.
- Active wave PRs #41/#42/#43: focused harnesses, TypeScript, production build, scoped lint, diff-check and independent review passed. PR #42 additionally passed disposable PostgreSQL 15 compilation, positive/negative, rollback and concurrency/freshness fixtures.
- Build/install generated an uncommitted `src/routeTree.gen.ts` change and `package-lock.json`; both are excluded from PR #35 and preserved as known generated artifacts.

## Phase 9.5 start

- Preserved four untracked implementation files unchanged in `C:\projects\usrtimetable-phase9-5-schedule-builder-v2`.
- The branch is nine commits behind current `origin/main`; no direct path collision was found.
- First gaps: the add-session dialog/service are not wired into a screen, no targeted harness exists, generated RPC types are absent, and the migration redefines security-sensitive schedule functions.
- Next gate: merge current main into the Phase 9.5 branch without rebasing, add targeted source tests, then run disposable PostgreSQL and security review before any source merge. No migration apply is authorized.

Estimated completion is not asserted from file count. Current source maturity is strongest in builder/conflicts and weakest in cohorts, end-to-end imports, regression coverage, and verified runtime state.
