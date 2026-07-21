# RUNLOG — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

## 2026-07-21 — G0 reconcile

- Fetched `origin/main` = `cbd4546886057297fee1bc8adec4eebfde729ab1` (matches last-known).
- PR #60 OPEN draft MERGEABLE CLEAN — `swarm/a1-3-legacy-write-blocking` @ `029bbe4e…`.
- PR #61 OPEN draft MERGEABLE CLEAN — `swarm/a1-5-reports-remediation` @ `c964cf59…`.
- Swarm control files missing from main; rebuilt under `implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/`.
- Lead worktree: `C:\projects\usrtimetable-a1-closure` (`swarm/a1-closure-lead`).
- PR60 worktree: `C:\projects\usrtimetable-pr60` @ `029bbe4e…`.
- No DB writes. No migration apply. No deploy/publish. A2 not started.
## 2026-07-21 — Track 1–5 execution

- Merged PR #60 → origin/main `52a9726…` (legacy write blocking; migration NOT APPLIED).
- Merged origin/main into PR #61 (merge commit, no rebase); merged PR #61 → `f941319…`.
- Post-merge gates on clean main: PASS (harnesses/tsc/build).
- A1 status: A1_SOURCE_COMPLETE + A1_PRODUCTION_REMEDIATION_PENDING.
- Track 4 read-only classification package created under implementation-reports/PHASE-A1-LEGACY-ORPHAN-CLASSIFICATION-01/.
- Track 5 source foundation on swarm/scheduling-headcount-foundation → Draft/Ready PR #62.
- No DB writes. No migration apply. No deploy/publish. A2 not started.

## 2026-07-21 — PR #62 merged; classification FAILED in Production

- PR #62 (scheduling headcount foundation, source-only) merged → origin/main `91b5f65e…`. Migration 20260721180000 NOT APPLIED.
- Lovable run of the Track-4 classification package on Production `emzytxqkxjjhsivqxdiu` **FAILED**: `column delivery_groups.course_offering_id does not exist`. Decision recorded by operator: `HOLD — LEGACY_ORPHAN_CLASSIFICATION_INCOMPLETE`. The failed package must NOT be rerun; the DG→offering relationship must NOT be guessed.
- origin/main advanced to `6c4401bb…` (Lovable tooling commit: vite-plugin 2.7.7; types.ts regen removing un-applied headcount table types; routeTree regen). No product logic change.

## 2026-07-21 — PHASE-A1-POSTMERGE-GATES-AND-LEGACY-SCHEMA-MAP-RECOVERY-01 (KIMI side)

- **G0:** canonical control files read from repo; main verified at `6c4401bb`. No duplicate PRs created; no merged phase re-executed.
- **Track 1:** `USRTIMETABLE-FINAL-MAIN-91B5F65-LOCAL-GATES.zip` prepared (5 files). Gates the ACTUAL origin/main in a dedicated worktree `C:\projects\usrtimetable-final-main-gates` with frozen install, 14 focused harnesses, tsc, build, scoped ESLint on delta `cbd4546..HEAD`, full suite (expectation 42), git diff --check, scope/tree cleanliness. Unified `results.json` (PASS / FAIL_CHANGE_RELATED / FAIL_BASELINE / NOT_RUN + triage rule). Decision tokens: `PASS — FINAL_MAIN_POSTMERGE_GATES_COMPLETE` / `HOLD — FINAL_MAIN_POSTMERGE_GATES_FAILED`.
- **Track 2:** `PHASE-A1-LEGACY-RELATIONSHIP-SCHEMA-MAP-01` package prepared (SQL + LOVABLE-EXEC + COMBINED). 10 statements, parser-validated SELECT-only. Covers: existence+columns of 9 tables, full FK inventory (validated status), 8-column table locations, delivery_groups indexes/unique constraints, 5-row DG sample, college-scoped samples (7168345f-…), candidate relationship proof matrix (PROVEN_BY_FK / PROVEN_BY_UNIQUE_KEY / SOURCE_ONLY_NOT_IN_PRODUCTION / NO_PROVEN_RELATION / UNKNOWN). No dynamic SQL; SELECT * samples only.
- **Track 3:** `PHASE-A1-CLASSIFICATION-V2-DESIGN-HOLD.md` — design hold documented: what is provable without DG matching (TEST, LEGACY_HISTORICAL, REQUIRED_FOR_OPERATION, dependency facts), what requires the proven relationship (MIGRATABLE_TO_V2, V2-alternative SAFE_TO_UNLINK), why UNKNOWN stays the default.
- **Track 4:** `SCHEDULING-HEADCOUNT-PRODUCTION-DEPENDENCY-MAP.md` — prerequisite = 20260717050000 composite keys (academic_cohorts/academic_terms); 20260720143000 independent (any order); 20260721090000 independent, strictly after A1.3b; types.ts regen self-heals after apply.
- No DB writes. No migration apply. No deploy/publish. A2 not started.

## Stop points (current)

- `USER_RUNS_FINAL_MAIN_GATES` — operator runs the ZIP, returns `C:\projects\usrtimetable-final-main-gates-results\FINAL-MAIN-<sha>\`.
- `USER_RUNS_LEGACY_RELATIONSHIP_SCHEMA_MAP` — operator runs the read-only schema-map SQL via Lovable, returns 10 CSVs; decision `PASS_WITH_FINDINGS — LEGACY_RELATIONSHIP_SCHEMA_MAP_COMPLETE` or `HOLD — LEGACY_RELATIONSHIP_SCHEMA_MAP_INCOMPLETE`.
