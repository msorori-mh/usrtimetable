# STAGE-03I — Controlled Teaching Assignments V2 Import

Mission: `PLATFORM-LAUNCH-STAGE-03I-CONTROLLED-V2-IMPORT-01`
Generated: 2026-07-28 (Asia/Riyadh)
Production: `emzytxqkxjjhsivqxdiu` · ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8`

**Hard bans honored:** no catalog/headcount/DG changes; no DELETE; no migrations; no Publish; no schedule; no Legacy mutation.

---

## FINAL_DECISION

`HOLD_WITH_ONE_EXACT_V2_IMPORT_BLOCKER`

### Exact blocker

`B-V2-IMPORT-READY-NATURAL-KEY-DUPLICATES`

READY Preview rows = **156**, but unique V2 natural keys (`delivery_group_id|instructor_id`) = **142**.
Extra collapsed rows = **14** across **12** duplicate keys (same DG + instructor from multiple source rows with differing hours / repeated lines).

Dry-run gate requires `duplicate_target_keys = 0` and `operations_expected = 156`.
Both cannot be satisfied without upsert/overwrite of the same natural key.
Import was **not** executed.

---

## APPROVAL_TEXT

Explicit user approval for Teaching Assignments V2 writes in this mission only (`insert_only` atomic path). Blocker stopped writes before commit.

## TEST_BATCH_ID

`E2E-ITCS-20260728-01`

## IMPORT_RUN_ID

`E2E-ITCS-20260728-01-V2-IMPORT-01` (reserved; **no job committed**)

## FILE_SHA256

`fbc23368ca36af452935ab086e239fff5b61bae668dd9be5887b330143a35098`
File: `C:\Users\Elite\Downloads\b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx`

## PREFLIGHT_COUNTS

| Metric | Expected | Actual |
|---|---:|---:|
| SOURCE_ROWS | 131 | 131 |
| EXPANDED_ROWS | 314 | 314 |
| READY | 156 | 156 |
| BLOCKED | 18 | 18 |
| AMBIGUOUS | 18 | 18 |
| NOT_FOUND | 122 | 122 |
| CONFLICT | 0 | 0 |
| Sum | 314 | 314 |

`PREFLIGHT_RESULT = PASS` (count board matches Stage 03H baseline).

## BACKUP_SHA256

Local: `C:\Users\Elite\Downloads\ITCS-STAGE03I-BACKUP-E2E-ITCS-20260728-01`

| File | SHA256 |
|---|---|
| `before-import.json` | `2d0c9b3540a551ee4c149ecc0fb34fd9f765481c211b4b47d9b938e77a957b03` |
| `ready-assignment-keys.csv` | `3624cb6e8dd12b14de9509eb2205253b9bef2c389eea497f30f31d3826924f8f` |

`BACKUP_RESULT = PASS` (read-only snapshot; not uploaded to GitHub).

## DRY_RUN_RESULTS

| Check | Result |
|---|---|
| DRY_RUN_EXPECTED | 156 |
| unique natural keys | 142 |
| duplicate_target_keys | 14 (extra rows) / 12 keys |
| invalid instructors | 0 |
| invalid delivery groups | 0 |
| cross-college | 0 |
| regular/parallel mix | 0 |
| legacy identity usage | 0 |
| destructive/replace | false |
| DRY_RUN_VALID | **false** |

Sample duplicate: IT232 Sem2 G1 + EMP013 appears 3× (hours 2 / 12 / 0) for regular and again for parallel (different DG ids).

## IMPORT_RESULT

**NOT EXECUTED** (stopped at dry-run).

| Metric | Value |
|---|---:|
| V2_ASSIGNMENTS_BEFORE | 0 |
| V2_ASSIGNMENTS_CREATED | 0 |
| V2_ASSIGNMENTS_AFTER | 0 |
| FAILED_ROWS | 0 |
| UNEXPECTED_WRITES | 0 |
| LEGACY_COUNT_BEFORE | 174 |
| LEGACY_COUNT_AFTER | 174 |
| DUPLICATES_CREATED | 0 |

## IDEMPOTENCY_RESULT

`NOT_RUN` (no import).

| Metric | Value |
|---|---:|
| IDEMPOTENT_REPLAY_NEW | n/a |
| IDEMPOTENT_REPLAY_SKIPPED | n/a |

## POST_IMPORT_PREVIEW

Unchanged vs preflight (no write):

| Metric | Value |
|---|---:|
| POST_PREVIEW_READY | 156 |
| POST_PREVIEW_BLOCKED | 18 |
| POST_PREVIEW_AMBIGUOUS | 18 |
| POST_PREVIEW_NOT_FOUND | 122 |
| POST_PREVIEW_CONFLICT | 0 |

## READINESS_AFTER

Unchanged (teaching assignments still missing for V2 path):

| Metric | Value |
|---|---:|
| READINESS_READY | 0 |
| READINESS_BLOCKED | 64 |

## CLEANUP_FILTER / ROLLBACK_RESULT

No created IDs. Rollback N/A.
Planned filter (if import later succeeds): `notes ILIKE '%import_run=E2E-ITCS-20260728-01-V2-IMPORT-01%'` OR recorded created IDs; expected delete count = unique keys imported; Legacy untouched.
`ROLLBACK_READY = yes` (no partial write; backup present).

## MIGRATIONS_APPLIED

`NONE`

## PUBLISH_PERFORMED

`NONE`

## DATABASE_WRITES

`NO` (V2 import not committed)

## Recommended next step (outside this mission)

Resolve READY natural-key collisions before re-attempt:

1. Deduplicate source lines that map to the same DG+instructor, **or**
2. Adjust Preview READY accounting to unique import keys, **or**
3. Explicit upsert policy with hours-merge rules (requires separate approval; not `insert_only` pure create=156).

Do **not** import BLOCKED/AMBIGUOUS/NOT_FOUND to inflate counts.

---

## Security Review

| Item | Value |
|---|---|
| Files changed (git) | this report only |
| Migrations / RLS / RPCs | no |
| Production V2 writes | none |
| Legacy changed | no |
| Secrets in git | no |
| Production risk | none (no import write) |
| Ready for merge (docs) | yes after CI |
