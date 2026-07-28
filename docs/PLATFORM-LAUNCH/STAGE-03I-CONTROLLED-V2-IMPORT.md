# STAGE-03I — Controlled Teaching Assignments V2 Import

Mission: `PLATFORM-LAUNCH-STAGE-03I-CONTROLLED-V2-IMPORT-01`
Follow-on: `PLATFORM-LAUNCH-STAGE-03I-B-NATURAL-KEY-DUPLICATE-RECONCILIATION-01`
Generated: 2026-07-28 (Asia/Riyadh)
Production: `emzytxqkxjjhsivqxdiu` · ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8`

**Hard bans honored:** no catalog/headcount/DG changes; no DELETE; no migrations; no Publish; no schedule; no Legacy mutation; no import confirm.

---

## FINAL_DECISION

### Stage 03I (import attempt)

`HOLD_WITH_ONE_EXACT_V2_IMPORT_BLOCKER` — `B-V2-IMPORT-READY-NATURAL-KEY-DUPLICATES`
Import was **not** executed.

### Stage 03I-B (reconciliation)

`STAGE_03I_B_DUPLICATES_RECONCILED_READY_FOR_IMPORT_PLAN`

All **14** extra READY rows are classified with evidence.
Correct executable import count after reconciliation = **138** (not 142 and not 156).

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

## NATURAL_KEY_DUPLICATE_RECONCILIATION

Mission: `PLATFORM-LAUNCH-STAGE-03I-B-NATURAL-KEY-DUPLICATE-RECONCILIATION-01`
Scope: **read / classify / document only** — no production writes.
File SHA256 (unchanged): `fbc23368ca36af452935ab086e239fff5b61bae668dd9be5887b330143a35098`
Preview re-run: SOURCE 131 · EXPANDED 314 · READY **156** · BLOCKED 18 · AMBIGUOUS 18 · NOT_FOUND 122 · CONFLICT 0

### Metrics

| Metric | Value |
|---|---:|
| READY_SOURCE_ROWS | 156 |
| DUPLICATE_SOURCE_ROWS (extra) | 14 |
| DUPLICATE_KEY_GROUPS | 12 |
| IDENTICAL_DUPLICATE_ROWS (extra) | 8 |
| CONFLICTING_DUPLICATE_ROWS (all members blocked) | 10 |
| CONFLICTING_DUPLICATE_GROUPS | 4 |
| UNIQUE_SINGLE_KEYS | 130 |
| TOTAL_NATURAL_KEYS before conflict filter | 142 |
| CANONICAL_UNIQUE_ASSIGNMENTS | **138** |
| BLOCKED_AFTER_RECONCILIATION (groups) | 4 |

### Is 142 correct?

**No.** 142 counts every natural key including 4 conflict groups.
After blocking conflict groups: `142 − 4 = 138` executable unique assignments.

Formula: `130` unique singles + `8` identical-payload canonical groups = **138**.

### Classification rules applied

- Identical import payload (`delivery_group_id`, `instructor_id`, `assigned_component_hours`, `component_type`, `is_active`, offering) → **one canonical assignment**; retain all source-row identities as evidence. No first/last-row silent pick beyond “any identical member is equivalent”.
- Differing affecting payload (hours) → **CONFLICT_BLOCK** entire group; no row dropped as winner; no overwrite.
- Natural key `delivery_group_id|instructor_id` retained (DG already binds cohort/course/component). No architectural key change.
- No EXPANSION_DUPLICATE of same source row onto the same key observed; regular/parallel use **different** DG ids (correct).

### Classification counts (12 groups)

| Primary class | Groups | Decision |
|---|---:|---|
| `SAME_ASSIGNMENT_IDENTICAL_PAYLOAD` | 8 | CANONICAL (1 assignment each) |
| `SOURCE_DATA_CONFLICT` (+ `SAME_ASSIGNMENT_DIFFERENT_PAYLOAD`) | 4 | CONFLICT_BLOCK |

### Conflict groups (must not import)

| Course | System | Term | Emp | Hours variants | Source rows | Key (short) |
|---|---|---|---|---|---|---|
| IT232 theory G1 | regular | Sem2 | EMP013 | 2 / 12 / 0 | Sem2 rows 94,95,97 | `feea17a4…\|f03b5a33…` |
| IT232 theory G1 | parallel | Sem2 | EMP013 | 2 / 12 / 0 | Sem2 rows 94,95,97 | `4bb7ca2c…\|f03b5a33…` |
| TST-IT-L1-S1-001 theory G1 | regular | 2026-T1 | EMP007 | 2 / 8 | Sem1 rows 47,51 | `6b24617f…\|6a88cdfe…` |
| TST-IT-L1-S1-001 theory G1 | parallel | 2026-T1 | EMP007 | 2 / 8 | Sem1 rows 47,51 | `3f6d18f6…\|6a88cdfe…` |

### Identical-payload canonical groups (import once)

| Course | Systems | Term | Emp | Hours | Source rows (each system) |
|---|---|---|---|---:|---|
| TST-CIS-L4-S1-001 | regular + parallel | 2026-T1 | EMP002 | 3 | Sem1 9, 11 |
| TST-CIS-L4-S1-007 | regular + parallel | 2026-T1 | EMP005 | 2 | Sem1 32, 33 |
| TST-CIS-L2-S1-001 | regular + parallel | 2026-T1 | EMP008 | 2 | Sem1 52, 53 |
| TST-CIS-L3-S1-003 | regular + parallel | 2026-T1 | EMP008 | 2 | Sem1 54, 55 |

(8 groups = 4 courses × regular/parallel DG pairs.)

### Extra-row accounting (14)

| Bucket | Extra rows |
|---|---:|
| Identical-payload collapse (8 groups × 1 extra) | 8 |
| Conflict groups extras (3+3+2+2 − 4 keys) | 6 |
| **Total** | **14** |
| Unexplained | **0** |

### Import plan (next mission; not executed here)

1. Build insert_only payload with **138** unique `delivery_group_id|instructor_id` keys.
2. For the 8 identical groups: include **one** payload member; keep source-row list in notes/audit evidence.
3. Exclude all 10 READY members of the 4 conflict groups (treat as blocked until official hours clarification).
4. Do **not** import BLOCKED/AMBIGUOUS/NOT_FOUND to inflate counts.
5. Expected create = **138**; expected skip on idempotent replay = 138.

### Stage 03I-B FINAL_DECISION

`STAGE_03I_B_DUPLICATES_RECONCILED_READY_FOR_IMPORT_PLAN`

---


---

## POST_PR110_CANONICAL_REBASELINE

Mission follow-on: `PLATFORM-LAUNCH-STAGE-03I-C-PR110-MERGE-PUBLISH-REBASELINE-01`
Generated: 2026-07-28 (Asia/Riyadh)

### Git / merge

| Field | Value |
|---|---|
| PR110_STATE | MERGED |
| PR110_HEAD | `a69853ef6ada437ded731395b7cb29cfceabbf37` |
| PR110_MERGE_COMMIT / MAIN_SHA | `b430a2349af80640ab24e6a761bb09c90e06c908` |
| Migration applied | **no** (source-only `20260728010000_…` remains unapplied) |
| DB writes | **none** |

### Publish

| Field | Value |
|---|---|
| Lovable status | Reported `Published` / `Up to date` after scheduled publish (no code/migration/Supabase changes) |
| LIVE `x-deployment-id` | `d921ed553dd374d8fbe49e6956c8eb2406f2ac9d446d177ce8e6c86b527f41b4` (unchanged through 8 probes) |
| LIVE PR110 markers (`canonicalOperations` / `_source_provenance` / `conflicting_assignment_duplicate`) | **false** |
| PUBLISH_RESULT | `CLAIMED_BY_LOVABLE_LIVE_NOT_UPDATED` |

### Preview rebaseline (same workbook; read-only; main @ `b430a23`)

Workbook: `C:\Users\Elite\Downloads\b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx`
FILE_SHA256: `fbc23368ca36af452935ab086e239fff5b61bae668dd9be5887b330143a35098`

| Metric | Value |
|---|---:|
| SOURCE_ROWS | 131 |
| EXPANDED_ROWS | 314 |
| READY_SOURCE_ROWS (MATCHED) | 156 |
| BLOCKED | 18 |
| AMBIGUOUS | 18 |
| NOT_FOUND (ERROR) | 122 |
| CONFLICT (resolver outcome) | 0 |
| Unique natural keys among READY | 142 |
| IDENTICAL_DUPLICATE_GROUPS | 8 |
| CONFLICTING_DUPLICATE_GROUPS | 4 |
| Analytical executable if partial-block | **138** (= 130 singles + 8 identical) |
| **CANONICAL_IMPORT_OPERATIONS (PR #110 emit)** | **0** |

### Contract behavior observed

`canonicalizeTeachingAssignmentsV2` **fail-closes the whole batch** when any natural-key fingerprint conflict exists:

- identical duplicates → would collapse to 1 op with `_source_provenance` (proven by harness)
- conflicting duplicates → `conflicting_assignment_duplicate` errors; **all** canonical ops emptied
- Live ITCS has **4** conflicting groups → emitted import ops = **0** (not 138)
- No conflicting payload enters a non-empty canonical array (fail-closed)
- No first-row / last-row silent overwrite for conflicts

Codex fixture `156→142` assumed **zero** payload conflicts; live data does not.

### Exact import count / blocked groups

| Item | Value |
|---|---|
| Exact import count under PR #110 as shipped | **0** (whole-batch fail-closed) |
| Exact import count under Stage 03I-B partial plan | **138** |
| Exact blocked conflict groups | **4** (10 READY rows) |
| V2 assignments | 0 (unchanged; no write) |
| Legacy count | 174 (unchanged) |

### Required updated approval (next)

Do **not** approve a 138 V2 import against the shipped whole-batch fail-closed client until one of:

1. **Source fix:** resolve the 4 hour-conflict groups so READY natural keys have no fingerprint conflicts, then re-preview must show `CANONICAL_IMPORT_OPERATIONS` matching the clean unique-key set; or
2. **Contract change (new PR):** emit partial-block canonical ops (138) while keeping conflicting keys fail-closed / non-importable; then re-merge/publish/rebaseline; or
3. **Live publish fix:** land PR #110 assets on `gomufadhala.com` (deployment id must change + markers true) before any live UI import approval.

Also still required: do **not** apply `20260728010000_teaching_assignments_v2_duplicate_contract.sql` until separately approved.

### Stage 03I-C FINAL_DECISION

`HOLD_WITH_ONE_EXACT_CANONICAL_IMPORT_RELEASE_BLOCKER`

Exact blocker: `B-CANONICAL-OPS-ZERO-NOT-138` — PR #110 whole-batch fail-closed yields `CANONICAL_IMPORT_OPERATIONS=0` on live ITCS READY data with 4 conflicting groups; required Stage 03I-C proof is `138`. Secondary: live deployment still lacks PR #110 markers.

## Security Review

| Item | Value |
|---|---|
| Files changed (git) | this report only |
| Migrations / RLS / RPCs | no |
| Production V2 writes | none |
| Legacy changed | no |
| Secrets in git | no |
| Production risk | none (analysis only) |
| Ready for merge (docs) | yes after CI |
