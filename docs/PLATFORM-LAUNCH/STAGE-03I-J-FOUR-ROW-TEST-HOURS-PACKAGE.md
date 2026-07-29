# STAGE 03I-J — Four-Row TEST Hours Package

Mission: `PLATFORM-LAUNCH-STAGE-03I-J-FOUR-ROW-TEST-HOURS-PACKAGE-01`
Generated: 2026-07-29 (Asia/Riyadh)
Scope: **package + offline simulation only** — no import, no DB writes, no migration, no publish, no merge of PR #114, no modification of the official attribution workbook.

Related: PR #112 (docs), PR #114 (code remediation — **open, not merged**), Stage 03I-I reconciliation.

## Baseline locked

| Field | Value |
|---|---|
| ORIGINAL_FILE_SHA256 | `fbc23368ca36af452935ab086e239fff5b61bae668dd9be5887b330143a35098` |
| ORIGINAL attribution file | unchanged |
| SOURCE_ROWS | 131 |
| EXPANDED_ROWS | 313 |
| READY_SOURCE_ROWS | 93 |
| CANONICAL_OPERATIONS | 87 |
| INVALID_HOURS_ROWS (before package) | **4** |
| TEACHING_HOURS_CONTRACT_BLOCKERS (live group-level) | 2 |
| V2 / Legacy | 0 / 174 |

## Invalid rows identified (exact 4)

All on sheet `اسناد الفصل الاول 2026`, course **FR231** / **theory**, weekly plan hours **2**.

| # | source_row | study_system | instructor | DG | before assigned | after assigned |
|---|---:|---|---|---|---:|---:|
| 1 | 82 | regular | EMP012 | `154ae39d-…530d` | 2 | **1** |
| 2 | 82 | parallel | EMP012 | `803f19d0-…77d4` | 2 | **1** |
| 3 | 118 | regular | EMP017 | `154ae39d-…530d` | 2 | **1** |
| 4 | 118 | parallel | EMP017 | `803f19d0-…77d4` | 2 | **1** |

Failure: `CO_TEACHING_HOURS_OVER_ALLOCATED` — each co-teacher received full component hours (sum 4 > weekly 2) on both regular and parallel delivery groups.

## Fix package

| Field | Value |
|---|---|
| FIX_FILE | `C:\Users\Elite\Downloads\ITCS-STAGE03I-J-FOUR-ROW-TEST-HOURS-FIX.xlsx` |
| FIX_FILE_SHA256 | `19ce0f547c0c8ec176dc7224225168ed60f7c9d901fdf4a6e8647e8910358d82` |
| FIX_ROWS | 4 |
| TEST_BATCH_ID | `TEST-BATCH-03I-J-FOUR-ROW-HOURS-20260729` |
| Correction | assigned_component_hours **2→1** (explicit co-teacher split 1+1) |
| Excel `اجمالي الساعات` | **unchanged (=2)** — required so PR113 single-component equality remains MATCHED |
| rollback_value | 2 (per row) |
| cleanup_key | `sheet\|source_row\|study_system\|course\|component\|instructor\|delivery_group_id` |

Sheets inside FIX workbook: `FIX_ROWS`, `MANIFEST`, `SIMULATION`.

### Why not rewrite Excel total hours to 1

Changing `اجمالي الساعات` from 2→1 would fail PR113 (`تعارض ساعات المصدر (1) مع ساعات المكوّن (2)`) and drop READY below 93. The package therefore corrects **assigned** hours only.

## Simulation (no writes)

| Metric | Result |
|---|---:|
| SOURCE_ROWS | 131 |
| EXPANDED_ROWS | 313 |
| READY_SOURCE_ROWS | 93 |
| CANONICAL_OPERATIONS | 87 |
| INVALID_HOURS (before → after) | 4 → **0** |
| OVERALLOCATED_INSTRUCTORS | **0** |
| DRY_RUN_VALID | **true** |
| PROTECTED_ROWS_CHANGED | **0** |
| STRICT_DOWNGRADE_ROWS_CHANGED | **0** |
| PRODUCTION_WRITES | **0** |

## Safety

- Official attribution workbook not modified (SHA verified).
- No INSERT/UPDATE/DELETE, no migration, no Lovable publish.
- PR #114 left unmerged.
- 63 strict downgrades untouched; no invalid row promoted from AMBIGUOUS.

## FINAL_DECISION

`STAGE_03I_J_TEST_HOURS_PACKAGE_READY`

## Security Review

| Item | Value |
|---|---|
| Files changed (this mission) | this report only (docs) |
| Migrations / RLS / RPCs | no |
| Authentication / Authorization impact | no |
| Sensitive data exposure | no (TEST employee codes only) |
| Privilege escalation risk | no |
| Production DB writes | **0** |
| Production risk | none |
| Ready for merge (docs PR #112) | yes (draft) |
| Ready for deploy | n/a — package only; do not merge PR #114 in this mission |
