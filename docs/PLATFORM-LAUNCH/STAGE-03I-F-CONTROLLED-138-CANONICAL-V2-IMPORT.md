# STAGE 03I-F — Controlled 138 Canonical V2 Import

Mission: `PLATFORM-LAUNCH-STAGE-03I-F-CONTROLLED-138-CANONICAL-V2-IMPORT-01`  
Generated: 2026-07-29 (Asia/Riyadh)

## APPROVAL_TEXT

Explicit Stage 03I-F approval for a single atomic `insert_only` import of **138**
canonical Teaching Assignments V2 operations for ITCS, with idempotency replay and
read-only readiness inspection. Migrations, Lovable publish, schedule creation,
auto-schedule, Legacy mutation, and silent overwrite remain forbidden.

## Identifiers

| Field | Value |
|---|---|
| TEST_BATCH_ID | `E2E-ITCS-20260728-01` |
| IMPORT_RUN_ID | `E2E-ITCS-20260728-01-V2-CANONICAL-IMPORT-01` |
| FILE_SHA256 | `fbc23368ca36af452935ab086e239fff5b61bae668dd9be5887b330143a35098` |
| CODE_MAIN_SHA (importer) | `8cf3f080e0c392252bf7edd2f784a262b2cf661c` |
| ORIGIN_MAIN_TIP | docs-only ahead (`65e5848…`); importer identical |
| LIVE_DEPLOYMENT | `7267337616764b206eaae80edfc44f92d03a91f504fb7b86885b92d3c074796b` |
| College | ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8` |
| Workbook | `b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx` |

## PREFLIGHT_COUNTS

| Metric | Expected | Observed |
|---|---:|---:|
| SOURCE_ROWS | 131 | 131 |
| EXPANDED_ROWS | 314 | 314 |
| READY_SOURCE_ROWS | 156 | 156 |
| CANONICAL_IMPORT_OPERATIONS | 138 | 138 |
| IDENTICAL_DUPLICATE_GROUPS | 8 | 8 |
| CONFLICTING_DUPLICATE_GROUPS | 4 | 4 |
| CONFLICTING_SOURCE_ROWS | 10 | 10 |
| BLOCKED | 18 | 18 |
| AMBIGUOUS | 18 | 18 |
| NOT_FOUND | 122 | 122 |
| Conflicting keys in payload | 0 | 0 |
| Duplicate canonical keys | 0 | 0 |
| V2 (delivery_group NOT NULL) | 0 | 0 |
| Legacy (delivery_group NULL) | 174 | 174 |

`PREFLIGHT_RESULT = PASS` (no `B-138-CANONICAL-IMPORT-PREFLIGHT-DRIFT`).

## BACKUP_SHA256

Backup folder: `C:\Users\Elite\Downloads\ITCS-STAGE03I-F-BACKUP-E2E-ITCS-20260728-01`  
`BACKUP_SHA256 = 11cc59d8bd845b864a9d63ca956b2222a7862e2bf5031cc8f62660b5b6d01b98`  
`BACKUP_RESULT = PASS`

Contents (no secrets): V2 before count/IDs, Legacy fingerprint, canonical 138 natural keys,
4 conflicting groups, isolation/rollback plan.

## Batch isolation

Supported by current schema (no new columns):

1. `notes` stamp: `import_run=E2E-ITCS-20260728-01-V2-CANONICAL-IMPORT-01;test_batch=E2E-ITCS-20260728-01`
2. Exact created IDs list (post-success)
3. `audit_logs.details.import_batch_id`

`ROLLBACK_READY = yes` (filter prepared; nothing persisted after failed apply).

## DRY_RUN_RESULT

Client validation (DG/instructor/college/offering resolvability, no duplicate targets):

| Check | Result |
|---|---|
| expected | 138 |
| duplicate target keys | 0 |
| conflicting keys included | 0 |
| invalid instructors | 0 |
| invalid delivery groups | 0 |
| cross-college | 0 |
| replace/destructive | false |
| atomic RPC | `commit_teaching_assignments_v2_import(..., insert_only)` |

**Server apply gate (co-teaching allocation):** FAIL

Two delivery groups in the 138-payload assign **2+2 hours** against component weekly **2**:

| Course | Cohort | Study system | Term | Weekly | Claimed sum | Instructors |
|---|---|---|---|---:|---:|---:|
| FR231 | CIS-L2-REG-2025-2026-T1 | regular | 2026-T1 | 2 | 4 | 2 |
| FR231 | CIS-L2-PAR-2025-2026-T1 | parallel | 2026-T1 | 2 | 4 | 2 |

Delivery group IDs:

- `154ae39d-bcf6-4213-b186-ac96b468530d`
- `803f19d0-b68b-4575-984d-5ae3b26b77d4`

These are **not** the Stage 03I conflict-fingerprint groups (4 groups / 10 rows). They are
distinct natural keys on the same delivery group with over-allocated co-teaching hours.
Importing all 138 without rewriting hours violates
`CO_TEACHING_HOURS_OVER_ALLOCATED`. Silent hour rewrite / dropping to 134 was **not** done
(no silent fallback; approval is exactly 138).

| Field | Value |
|---|---|
| DRY_RUN_EXPECTED | 138 |
| DRY_RUN_VALID | **false** (co-teaching over-allocation inside approved 138) |

## IMPORT_RESULT

| Field | Value |
|---|---|
| RPC | `commit_teaching_assignments_v2_import` |
| Mode | `insert_only` |
| Status | **EXCEPTION** `CO_TEACHING_HOURS_OVER_ALLOCATED` |
| Transaction | **fully rolled back** |
| V2_ASSIGNMENTS_BEFORE | 0 |
| V2_ASSIGNMENTS_CREATED | **0** |
| V2_ASSIGNMENTS_AFTER | **0** |
| FAILED_ROWS | n/a (atomic abort) |
| UNEXPECTED_WRITES | 0 |
| CONFLICTING_GROUPS_IMPORTED | 0 |
| tagged notes rows remaining | 0 |
| CREATED_IDS | none |

## LEGACY_BEFORE_AFTER

| Field | Before | After |
|---|---:|---:|
| Legacy count | 174 | 174 |
| Legacy fingerprint | unchanged | unchanged |

## IDEMPOTENCY_RESULT

`NOT_RUN` (primary import did not persist).

| Field | Value |
|---|---|
| IDEMPOTENT_REPLAY_NEW | n/a |
| IDEMPOTENT_REPLAY_SKIPPED | n/a |
| V2_ASSIGNMENTS_AFTER_REPLAY | 0 |

## POST_IMPORT_PREVIEW

Unchanged vs preflight (no persisted write):

| Field | Value |
|---|---:|
| SOURCE_ROWS | 131 |
| EXPANDED_ROWS | 314 |
| READY / CANONICAL | 156 / 138 |
| POST_PREVIEW_ALREADY_IMPORTED | 0 |
| POST_PREVIEW_BLOCKED | 18 |
| POST_PREVIEW_AMBIGUOUS | 18 |
| POST_PREVIEW_NOT_FOUND | 122 |
| POST_PREVIEW_CONFLICT | 0 |
| Conflicting duplicate groups still blocked | 4 |

## READINESS_AFTER

| Field | Value |
|---|---:|
| READINESS_READY | 0 |
| READINESS_BLOCKED | 64 |

Auto-schedule was **not** run. Query-error cells remain treated as blocked.

## CLEANUP_FILTER / ROLLBACK_RESULT

| Field | Value |
|---|---|
| ROLLBACK_READY | yes |
| exact delete filter (if a future success) | `college_id=ITCS AND delivery_group_id IS NOT NULL AND notes ILIKE '%import_run=E2E-ITCS-20260728-01-V2-CANONICAL-IMPORT-01%'` |
| expected delete count after success | 138 |
| this run rollback | N/A — atomic abort left V2=0 |
| Legacy protection | filter requires `delivery_group_id IS NOT NULL` + import_run tag |

## MIGRATIONS_APPLIED

`NONE`

## PUBLISH_PERFORMED

`NONE`

## DATABASE_WRITES

Net production writes: **0** (attempted insert rolled back by RPC exception).

## Exact blocker

`B-138-CO-TEACHING-HOURS-OVER-ALLOCATED`

The approved 138-canonical payload cannot be committed atomically because 4 natural keys
(2 FR231 delivery groups × 2 instructors) claim 2+2 hours against weekly component hours 2.
Remediation requires a new explicit approval to either:

1. Correct source hours to a valid split (e.g. 1+1) and re-preview to a new canonical count; or
2. Exclude those 4 keys and approve a **134** import; or
3. Change allocation policy/component hours with a separate approved change.

## FINAL_DECISION

`HOLD_WITH_ONE_EXACT_138_CANONICAL_IMPORT_BLOCKER`

Exact blocker id: `B-138-CO-TEACHING-HOURS-OVER-ALLOCATED`

## Security Review

| Item | Value |
|---|---|
| Files changed (git) | this report only |
| Migrations / RLS / RPCs | no |
| Production V2 rows created | 0 |
| Legacy changed | no |
| Secrets / Excel / backups in git | no |
| Production risk | none (aborted transaction) |
| Ready for merge (docs) | yes (draft) |
| Ready for deploy | n/a |
