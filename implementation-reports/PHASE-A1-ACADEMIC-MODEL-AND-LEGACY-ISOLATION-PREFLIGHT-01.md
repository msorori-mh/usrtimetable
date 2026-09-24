# PHASE-A1-ACADEMIC-MODEL-AND-LEGACY-ISOLATION-PREFLIGHT-01

## Decision

`PASS_WITH_FINDINGS — PHASE_A1_PREFLIGHT_COMPLETE`

This decision completes the requested preflight documentation; it does not authorize A1 implementation or production changes.

## Baseline and G0

- Worktree: `C:\projects\usrtimetable-phase-a1-preflight`
- Branch: `codex/phase-a1-academic-model-legacy-isolation-preflight`
- Expected and observed baseline: `a8e5c0256134d8b41aae1d3dcc8f65d534680db6`
- Initial worktree: clean
- Initial `HEAD`: equal to `origin/main`

## Parallel agents

| Agent | Task | Result |
| --- | --- | --- |
| `program_department` | Program/department schema, UI, RLS, import, reports, data risk | Required/same-college source contract; cascade/audit/report/runtime findings |
| `legacy_inventory` | Sections/COS/reference inventory and classification | 798 lines/124 files; 9 route files; 8 logical writers; 5 reports |
| `ui_terminology` | Navigation, official labels, report sources, catalogs | Legacy visible; terminology drift; several reports/readiness require new sources |
| `mutations_authz` | Direct/RPC mutations, RLS, grants, tenant/system isolation | V2 AuthZ generally sound; direct Legacy/DG/TA writes and Builder compatibility remain |
| `data_tests_split` | Read-only SQL, test plan, A1.1–A1.5 split | Production counts unknown; supplied SELECT-only verification and implementation split |

Agents performed read-only analysis and did not edit shared files. The leader reconciled and wrote all deliverables.

## Reconciliation decisions

1. `department_id NOT NULL` and its trigger are the source state; production state is unknown until an approved read-only run.
2. Builder V2 does not require a section value, but passing/writing it when present is still a Legacy dependency and is not accepted as full isolation.
3. Legacy references are reported as reproducible textual matching lines/files, not database relationships.
4. User-facing count is reported as 9 route files, with the operational subset of 7 stated separately.
5. Legacy logical writers are 8; split approval is disclosed as a ninth callable compatibility surface if counted independently.
6. Historical Legacy data and migrations remain intact and readable; no deletion is proposed.

## Deliverables

- `docs/PHASE-A1-ACADEMIC-MODEL-AND-LEGACY-ISOLATION-PREFLIGHT.md`
- `docs/PHASE-A1-LEGACY-USAGE-INVENTORY.md`
- `docs/PHASE-A1-PROGRAM-DEPARTMENT-INTEGRITY-MATRIX.md`
- `docs/PHASE-A1-IMPLEMENTATION-PLAN.md`
- `implementation-reports/PHASE-A1-ACADEMIC-MODEL-AND-LEGACY-ISOLATION-PREFLIGHT-01.md`
- External, untracked read-only SQL: `C:\projects\PHASE-A1-PRODUCTION-READONLY-PREFLIGHT.sql`

## Safety statement

- Product source changes: none.
- Migration changes: none.
- DB writes: none.
- Migration apply: none.
- Data deletion/cleanup: none.
- Deploy/publish: none.
- A2/A3/A4 work: none.

## Quality gates

| Gate | Result |
| --- | --- |
| Domain contract harness | PASS — 37 tables checked; `programDepartmentRequired: true` |
| Admin routes inventory harness | PASS — 42 nav routes, 57 authenticated route modules; finding `legacySectionsInNav: true` |
| TypeScript (`tsc --noEmit`) | PASS |
| Production build | PASS; existing bundler/chunk warnings only |
| Full lint | BASELINE FAIL — repository-wide CRLF/Prettier errors in unchanged files including `eslint.config.js` and `scripts/**`; no product files were reformatted because that is outside preflight scope |
| `git diff --check` | PASS |
| Scope check | PASS — only the five required `docs/**` / `implementation-reports/**` files are tracked changes |

The repository uses `bun.lock`, but Bun was unavailable and no npm lock exists. Verification used an untracked local `node_modules` junction to the matching mainline worktree; no lockfile or source change resulted.

## Next step

`USER REVIEW OF PHASE A1 IMPLEMENTATION PLAN.`
