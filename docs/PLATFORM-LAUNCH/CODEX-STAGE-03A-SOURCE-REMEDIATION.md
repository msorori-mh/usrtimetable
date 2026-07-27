# PLATFORM-LAUNCH-STAGE-03A-SOURCE-REMEDIATION-01

## CONFIRMED_SOURCE_BUGS

| ID | Evidence | Remediation | Result |
|---|---|---|---|
| S1-CARRY-FORWARD | `parseSourceSheetMatrix` carried instructor/course/level but left an empty program cell empty. This reproduced the merged-cell shape documented by K3. | Carry program forward within each sheet; added an anonymized real-layout fixture covering program, level, and course continuation. | FIXED |
| S1-EXPAND-HOURS | `toImportRow` assigned the workbook row total to every expanded component. A 2h theory + 2h practical row with total 4 emitted 4h twice and violated the server allocation contract. | `expand_all` now emits each component's `weekly_contact_hours`; single-component matching retains the explicit row hours. | FIXED |
| S1-ALIAS-GUESSING | Program fragments used bidirectional substring matching, so incomplete labels could resolve by guess. Documented campus/spelling labels were not explicit. | Matching is exact after stable Arabic normalization. Explicit aliases cover `امن سبراني`, all-departments-with-Al Jawf, and known campus qualifiers. Partial labels remain `unknown`; ambiguity never becomes `MATCHED`. | FIXED |
| S2-BASE-FAIL-OPEN | Eight readiness queries used `data ?? []` without inspecting `error`; network/RLS/PostgREST failures appeared as zero rows. | Every base query is checked and throws `READINESS_QUERY_FAILED[relation]` with the server message. | FIXED |
| S2-V2-FAIL-OPEN | New Flow query failure returned `null`, then emitted `total=0, missing=0`, which could score as success. | New Flow errors throw `NEW_FLOW_READINESS_QUERY_FAILED`; the defensive null metric is critical with `1/1` missing. | FIXED |
| S2-STALE-GATE | The button relied only on cached readiness. | The mutation re-fetches readiness immediately before any scheduler write and rejects with the concrete blocker labels. Query errors are displayed to the operator. | FIXED |
| S3-SWALLOWED-ERRORS | Scheduler settings/templates/offerings/assignments/rooms/availability and destructive deletes ignored query errors; insert errors became an ordinary “unplaced” result. | Read/delete/insert failures now throw relation-specific errors. No failed write is converted to a scheduling outcome. | FIXED |

The importer persistence path was independently rechecked: preview lookup queries throw on error, commit uses only `commit_teaching_assignments_v2_import`, and the RPC contract is atomic/idempotent with explicit modes. No client-side partial write or silent overwrite was found.

## REJECTED_FINDINGS

- No source defect was found in the existing publish-gate migration. `20260718120000_source_only_atomic_schedule_version_lifecycle.sql` defines a `SECURITY DEFINER` transition RPC with fixed `search_path`, explicit PUBLIC/anon revokes, authenticated execute, direct table UPDATE revocation, restricted column grant, and immutability triggers. Its production application remains outside this source-only task.
- No additional proven defect was found in the existing instructor, room, section/subgroup, capacity, room-type, hard-availability, study-system-template, or unscheduled-reason contracts. Existing conflict/runtime harnesses pass.
- The six previously reported workbook labels are not all program aliases. Campus tokens are ignored only when explicitly known; `الموازي` is not guessed as a program.

## FILES_CHANGED

- Importer: `program-aliases.ts`, `teaching-assignments-source-parser.ts`, `teaching-assignments-source-resolver.ts`.
- Readiness/scheduler: `readiness.ts`, `auto-schedule.tsx`, `greedy.ts`.
- Tests: anonymized workbook fixture, importer regression assertions, Stage 03A fail-closed contract, updated historical readiness assertion, harness registry.
- Documentation: this report only.

## TESTS_ADDED

- Anonymized real-layout workbook fixture: merged/blank program, level, and course cells; campus-qualified all-departments label; no personal data.
- Importer regressions: exact aliases/no partial guessing, program/level/course carry-forward, `expand_all` 2h+2h payload.
- Readiness regressions: base network/query failures, PostgREST/New Flow relation failures, missing headcount/groups/assignments, rooms/times and invalid room setup.
- Scheduler regressions: query/delete/insert errors are fail-closed.
- Publish source contract: privileged RPC, fixed search path, explicit grants/revokes, direct-update revocation.

Verification on the final source:

| Command | Result |
|---|---|
| `bun install --frozen-lockfile` | PASS — Bun 1.3.14, locked dependencies installed |
| `git diff --check` | PASS |
| `bunx tsc --noEmit` | PASS |
| `bun run build` | PASS — existing non-fatal bundler warnings only |
| `bun test` | PASS — 4 passed, 0 failed |
| `bun run test:harness` | PASS — 49 passed, 0 failed, 0 missing |
| Runtime-gates equivalent | PASS locally: diff check + typecheck + build + harness |

## MIGRATIONS_CREATED_SOURCE_ONLY

None. Creating a duplicate publish-gate migration was rejected because the required hardened source migration already exists. No migration was applied.

## PRODUCTION_ACTIONS_REQUIRED

1. Reconcile and, under a separately approved production-write procedure, apply the existing atomic schedule-version lifecycle migration if the production inventory still shows it absent.
2. Run authenticated preview/commit/re-import tests with the real workbook after official catalog gaps are reconciled.
3. Run live readiness failure injection and three-role RLS/RPC checks.
4. Do not run the current `/auto-schedule` New Flow release path until the blocker below is remediated.

No production write, migration apply, academic-data change, Lovable Publish, or merge occurred in this task.

## ROLLBACK

- Revert the importer commit to restore prior parsing/resolution behavior.
- Revert the readiness/scheduler commit to restore prior behavior; this is not recommended because the prior behavior was fail-open.
- The test/docs commit is non-operational.
- No database rollback is required because no migration was created or applied.

## FINAL_DECISION

`HOLD_WITH_ONE_EXACT_SOURCE_REMEDIATION_BLOCKER`

Exact blocker: the live `/auto-schedule` route still calls `runGreedyAutoSchedule`, whose operational unit identity is Legacy `course_offerings` + `section_id`; it does not schedule from V2 `delivery_group_id`/`cohort_id`. Consequently delivery-group/cohort conflict isolation cannot be proven for the New Flow auto-scheduler without replacing that runtime path with the existing V2 work-item and guarded session-creation contracts. This was confirmed directly in `src/routes/_authenticated/auto-schedule.tsx` and `src/lib/auto-scheduler/greedy.ts`; it is not safe to disguise it as READY.
