# Timetable Autopilot Log

## 2026-07-18 — Source-only wave remediation

- Launched three clean agents from `origin/main` without touching the preserved dirty mainline.
- PR #47 replaced network/shell harness execution with locked local `tsx`, registered merged harnesses, added deterministic summaries and a 120-second per-harness timeout. Independent review found no remaining BLOCKER/HIGH/MEDIUM; merged as `ae14d6d4429ab125dda829ceb189baf5bcc499b2`.
- PR #46 initially failed review for historical-migration mutation and incomplete concurrency invariants. Remediation restored the historical migration, added forward-only `20260718183000_forward_harden_cohort_curriculum_runtime.sql`, enforced one active plan, approved elective decisions, shared input-writer locks including courses, uniform tenant denial, idempotency and atomic audit. PostgreSQL 15 old-baseline then forward proof passed; merged source-only as `c7785c638957cc64d48601c6f3c8ba9408ad9636`.
- Draft PR #45 closed same-count payload substitution, replay and job/audit CAS gaps, but independent review retained HIGH because entity domain writes are still client-side across multiple requests and cannot roll back atomically. PR #45 remains Draft and isolated; no merge.
- Production DB writes: none. Migration apply: none. Deploy/publish: none. Actual import/publication: none.

## 2026-07-18 — Active wave completion

- Preserved dirty `C:\projects\usrtimetable-mainline` and executed only in isolated worktrees from live `origin/main`.
- PR #41 academic-plan/cohort alignment passed focused harness, TypeScript, build, scoped lint, diff-check and independent review; merged with merge commit `99bd0b24fc02133eec8d99f257b8eea4cc37759a`.
- PR #43 conflict/exception reporting closed a HIGH stale-evidence finding by failing closed when session evidence postdates the stored conflict check; merged with merge commit `75e346e1246c9181f563fe340cba1a109c637d70`.
- PR #42 lifecycle closed repeated HIGH concurrency/freshness findings using eligibility revisions, conditional quality-run persistence, deterministic OLD/NEW invalidation, tenant-wide invalidation for all scorer inputs, and direct quality DML revocation. Disposable PostgreSQL 15 compilation, positive/negative fixtures, rollback and race proofs passed; merged source-only with merge commit `a1862a8a5ff1a3a546d1e12e545c75c5d5a9dfb1`.
- Independent final review reported no BLOCKER/HIGH/MEDIUM on PR #42 and no BLOCKER/HIGH on PRs #41/#43 before merge. Known LOW: conservative lifecycle invalidation may cause write amplification under bulk configuration edits.
- All external agent PIDs ended normally and proven-stale locks were removed; completed agents were not restarted.
- Production DB writes: none. Migration apply: none. Deploy/publish: none. Actual timetable publication: none.

## 2026-07-18 — Next agent wave initialization

- Created a clean leader worktree from live `origin/main` `df0dad5`; preserved dirty `C:\projects\usrtimetable-mainline` untouched.
- Recorded the binding academic model: approved study plan and cohort curriculum are authoritative, electives are approved at cohort level, `academic_cohort` is the primary student context, and delivery groups are teaching splits only.
- Classified `sections` and `course_offering_sections` as Legacy-only compatibility structures and prohibited new `section_id` dependencies without documented compatibility need.
- Reconfirmed strict `regular`/`parallel` isolation and all production prohibitions.
- Prepared the next three isolated agent scopes: atomic schedule lifecycle, academic-plan/cohort alignment, and conflict/exception reporting.

## 2026-07-17 — Initial cycle

- Read the initialization request and confirmed repository/project identity.
- Fetched remote refs and inventoried Git, 15 pre-existing worktrees, branches, PRs and CI.
- Preserved dirty worktrees and created `C:\projects\usrtimetable-autopilot` from `origin/main` on `codex/timetable-autopilot-state`.
- Inventoried builder, lifecycle, cohorts, offerings, imports, conflicts, reports, security and migrations.
- Confirmed no GitHub Actions workflows/runs and one open conflicting PR (#30).
- Confirmed 94 local migrations, 15 source-only files, unknown remote applied state, and no authorized production action.
- Repaired the malformed first-line SQL comment; independent review passed and confirmed no DDL/DML semantic change.
- `git diff --check` passed. The full harness timed out after 124 seconds with no output.
- Dependency installation timed out repeatedly; build/typecheck/lint remain unverified because `vite` was not installed. The attempt generated an untracked `package-lock.json`, which was preserved and not treated as project source.
- Created and activated the hourly thread automation `University Timetable Autopilot Hourly Continuation`; the current cycle is its first execution. The available automation API has no run-now operation.
- Production impact: none.

## 2026-07-17 — Accelerated continuation cycle

- Began with `origin/main` at `9b7519e` and kept dirty local `main` untouched.
- Independently reviewed PR #35, confirmed its SQL change was comment-only, marked it ready, and merged it as `f77277d` without deleting the branch.
- Re-ran TypeScript, build, scoped lint baseline comparison, and independent review for PR #34; merged it as `7494b37` without deleting the branch.
- Verified PR #33 on disposable local PostgreSQL 15: all 21 same-college references passed, all 21 cross-college references failed correctly, nullable legacy paths passed, second apply was idempotent, and collision/preflight failures rolled back without cleanup.
- Removed all disposable PostgreSQL containers. Temporary test SQL remains outside the repository at `C:\projects\pr33-disposable-pg` because environment policy rejected its removal.
- Re-ran PR #33 source harness, TypeScript, production build, scoped lint, and `git diff --check`; final security review found no HIGH/CRITICAL findings.
- Marked PR #33 ready and merged it source-only as `5c20ea6`. Status: `MERGED_SOURCE_ONLY — PRODUCTION_APPLY_REQUIRES_USER_APPROVAL`.
- PR #30 remains conflicting and isolated.
- Resumed Phase 9.5 Schedule Builder V2 assignment-integration foundation in its preserved worktree and completed its initial gap inventory. The four untracked files remain unchanged; UI wiring, targeted tests, generated RPC types, and disposable PostgreSQL security verification are the next gates.
- Database writes: disposable local PostgreSQL fixtures only; production writes: none.
- Production migration apply, deploy, and publish: none.

## 2026-07-17 — Continuation cycle 2

- Fetched remote refs; `origin/main` remained `9b7519e`, local `main` remained 28 commits behind and preserved dirty.
- Reconfirmed one open conflicting PR (#30), no checks, and no GitHub Actions runs.
- Inventoried 16 worktrees and preserved the active untracked Phase 9.5 implementation.
- Diagnosed the harness timeout: `tests/harness/run.mjs` synchronously invokes undeclared `npx tsx`; dependency installation itself completed successfully.
- Ran all harness files directly with Bun: 21 passed and 3 pre-existing source-contract failures were isolated.
- Production build passed. TypeScript retained two baseline implicit-any errors. Lint retained repository-wide CRLF/Prettier failures.
- Created isolated worktree `C:\projects\usrtimetable-security-hardening` and drafted source-only cross-college composite-reference hardening plus a static harness covering 21 relations.
- The security draft made no database or production writes; targeted harness and `git diff --check` passed. Independent review and disposable PostgreSQL proof remain gates.
- Independent security review found and closed two HIGH catalog-validation gaps (wrong same-name constraint definition and `ON UPDATE CASCADE`). Final source review passed with no HIGH/CRITICAL findings.
- Committed and pushed security commit `8b1d74b`; opened Draft PR #33. It is not merge-ready until disposable PostgreSQL integration succeeds.
- Isolated and fixed the two TypeScript implicit-any baseline errors. TypeScript and independent review passed; commit `d327dca` was pushed and Draft PR #34 opened.
- Committed durable state files and the comment-only SQL repair as `22e4a9d`; opened Draft PR #35. Generated `src/routeTree.gen.ts` and `package-lock.json` were explicitly excluded and preserved.
- Production impact: none.
