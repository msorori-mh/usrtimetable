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

## FINAL_DECISION (03I-F)

`HOLD_WITH_ONE_EXACT_138_CANONICAL_IMPORT_BLOCKER`

Exact blocker id: `B-138-CO-TEACHING-HOURS-OVER-ALLOCATED`

---

## TEACHING_HOURS_OVERALLOCATION_RECONCILIATION

Mission: `PLATFORM-LAUNCH-STAGE-03I-G-TEACHING-HOURS-OVERALLOCATION-RECONCILIATION-01`  
Generated: 2026-07-29 (Asia/Riyadh)  
Scope: **read / analyze / remediation package only** — no import confirm, no INSERT/UPDATE/DELETE, no migration, no publish, no schedule, no production hour/instructor edits.

Artifact (local, not in git):  
`C:\Users\Elite\Downloads\ITCS-STAGE03I-G-HOURS-RECONCILIATION\reconciliation.json`

### G0 — Blocker reproduction

Same workbook + same preview rebuilt:

| Metric | Value |
|---|---:|
| SOURCE / EXPANDED / READY / CANONICAL | 131 / 314 / 156 / **138** |
| First abort code | `CO_TEACHING_HOURS_OVER_ALLOCATED` |
| Co-teach overallocated DGs (abort surface) | **2** |
| All DGs failing `sum(assigned) > weekly_contact_hours` | **54** |
| Canonical ops needing hour change | **56** |
| Max overage (hours) | **8** |

**Abort surface (co-teach FR231):**

| delivery_group_id | term | study_system | weekly | assigned sum | instructors | overage |
|---|---|---|---:|---:|---|---:|
| `154ae39d-bcf6-4213-b186-ac96b468530d` | 2026-T1 | regular | 2 | 4 | EMP012, EMP017 | 2 |
| `803f19d0-b68b-4575-984d-5ae3b26b77d4` | 2026-T1 | parallel | 2 | 4 | EMP012, EMP017 | 2 |

Atomic RPC aborts on the first failing DG. **52 additional single-instructor DGs** in the same 138 payload also have `assigned > weekly` and would fail the same allocation gate if reached.

### G1 — Hours matrix (`instructor × term × study_system`)

- Terms fully separated: `2026-T1` (30 cells) and `Sem2` (24 cells).
- Regular / parallel never merged in a cell.
- Instructor workload over cells (`total > max_weekly_hours`): **0**.
- Blocker is **delivery-group allocation vs component weekly**, not faculty workload limits.

Full matrix: `reconciliation.json` → `G1_MATRIX`.

### G2 — Hours calculation verification

| Question | Finding |
|---|---|
| What is Excel `اجمالي الساعات`? | Source `totalHours` — used for component matching; when match is not `expand_all`, copied into `assigned_component_hours` (except `project` type uses component weekly). |
| Weekly vs course-total vs per-group? | Intended as **weekly contact hours of the matched component**; TEST Excel often carries **course-total / multi-component totals**. |
| Delivery-group expansion | `both` study systems create **separate** DGs/ops; hours are per DG — **not** the co-teach 2+2 cause. |
| Same source row twice? | No double-count in canonical (identical NK collapsed). |
| Identical duplicates counted? | No — canonical unique keys = 138. |
| Conflicting four groups included? | **0** conflicting keys in canonical payload. |
| Theory/practical double? | `expand_all` assigns each component its weekly; single-match path copies Excel once per op. |
| Cross-term mix? | No — matrix and DG checks are term-scoped via cohort. |
| Regular/parallel mix in one DG check? | No — separate DGs. |
| Legacy in V2 preflight? | **No** — V2 payload DGs only; Legacy count remains 174, unchanged. |

**Confirmed source bugs (resolver):**

1. `toImportRow` copies full Excel/component hours to **every** co-teacher on the same DG (no split).
2. `matchComponentsByHours` short-circuits when `assignable.length === 1` **without** requiring Excel hours == weekly; then `toImportRow` copies Excel total even when it exceeds weekly.

### G3 — Classification (one category per overallocated DG)

| Category | Count (DGs) | Ops | Root |
|---|---:|---:|---|
| `SOURCE_HOURS_DUPLICATED` | 2 | 4 | Co-teachers each get full hours (FR231 EMP012+EMP017) |
| `OTHER_WITH_EVIDENCE` | 52 | 52 | Single-component match + Excel total > weekly |
| `EXPANSION_HOURS_DOUBLE_COUNT` | 0 | — | Ruled out |
| `IDENTICAL_DUPLICATE_HOURS_COUNTED` | 0 | — | Ruled out |
| `CROSS_TERM_AGGREGATION` | 0 | — | Ruled out |
| `LEGACY_AND_V2_DOUBLE_COUNT` | 0 | — | Ruled out |
| `TEST_INSTRUCTOR_OVERASSIGNED` | 0 | — | Workload matrix clean |
| `WORKLOAD_LIMIT_CONFIGURATION_ERROR` | 0 | — | N/A |
| `VALID_OVERALLOCATION` | 0 | — | RPC correctly rejects; payload invalid for import |

### G4 — Remediation package (**not executed**)

**A. Code (recommended for product; not applied here):**

- `src/lib/excel-import/teaching-assignments-source-resolver.ts`
  - `matchComponentsByHours`: do not silent-match single assignable when Excel ≠ weekly.
  - `toImportRow`: never assign Excel hours above `weekly_contact_hours`; co-teach split policy or explicit shares.
- Unit tests for co-teach full-hours and Excel-total-vs-weekly mismatch.

**B. EMP remapping:** **not required** (0 workload-over cells; same 138 NKs kept).

**C. TEST hours fix (preferred for this batch):**

| Pattern | Ops | Before → After (simulation) |
|---|---:|---|
| Co-teach split | 4 | 2 → **1** |
| Clamp Excel→weekly | 32 | 3 → **2** |
| Clamp | 12 | 6 → **2** |
| Clamp | 4 | 4 → **2** |
| Clamp | 2 | 10 → **2** |
| Clamp | 2 | 4 → **3** |
| **Total** | **56** | same 138 natural keys |

- `TEST_BATCH_ID` / cleanup key unchanged: `E2E-ITCS-20260728-01` / `E2E-ITCS-20260728-01-V2-CANONICAL-IMPORT-01`
- No official plan-catalog hour edits outside TEST remediation path.

### G5 — Simulation (post planned hours fix)

| Gate | Result |
|---|---|
| canonical operations | **138** |
| unique keys | **138** |
| instructors overallocated (workload) | **0** |
| DG hour overallocations | **0** |
| invalid hours | **0** |
| duplicate keys | **0** |
| conflicting groups included | **0** |
| regular/parallel mismatches | **0** |
| cross-term aggregation | **0** |
| Legacy changed | **0** |
| dry-run valid | **true** |

### Reconciliation board fields

| Field | Value |
|---|---|
| ROOT_CAUSE | Co-teach full-hour copy + single-component Excel-total copy above weekly (`SOURCE_HOURS_DUPLICATED` + `OTHER_WITH_EVIDENCE`) |
| AFFECTED_INSTRUCTORS | EMP001, EMP002, EMP003, EMP004, EMP006, EMP007, EMP008, EMP009, EMP010, EMP012, EMP013, EMP014, EMP017, INST-040 |
| OVERALLOCATED_ASSIGNMENTS | 56 canonical ops / 54 DGs |
| HOURS_BEFORE | see `G4_BEFORE_AFTER_HOURS` in artifact |
| HOURS_AFTER_SIMULATION | clamp/split to component weekly (patterns above) |
| SOURCE_FIX_REQUIRED | **YES** (resolver) — recommended before non-TEST imports |
| TEST_DATA_FIX_REQUIRED | **YES** (assigned hours on 56 ops in import payload; mappings unchanged) |
| EXACT_PRODUCTION_WRITE_SET | **none this mission**; later remediation = atomic `insert_only` of 138 with corrected hours + notes stamp (V2 still 0 today) |
| EXPECTED_CANONICAL_COUNT | **138** |
| ROLLBACK | unchanged filter: ITCS + `delivery_group_id IS NOT NULL` + `notes ILIKE '%import_run=E2E-ITCS-20260728-01-V2-CANONICAL-IMPORT-01%'` |
| NEXT_APPROVAL_REQUIRED | Explicit Stage 03I-H (or hours-remediation) approval to apply TEST hour corrections and/or code fix, then re-run controlled 138 import |

### FINAL_DECISION (03I-G)

`STAGE_03I_G_READY_FOR_TEACHING_HOURS_REMEDIATION`

---

## POST_PR113_TEACHING_HOURS_REBASELINE

Mission: `PLATFORM-LAUNCH-STAGE-03I-H-PR113-MERGE-PUBLISH-HOURS-VERIFY-01`  
Generated: 2026-07-29 (Asia/Riyadh)

### PR113 merge

| Field | Value |
|---|---|
| PR113_STATE | MERGED |
| PR113_HEAD | `3776bbc179ee26264542a6df753ffa95e577ec2a` |
| PR113_MERGE_COMMIT | `2cbff419bd1ea05528e9e97c325150502110c488` |
| NEW_MAIN_SHA / MAIN_SHA | `2cbff419bd1ea05528e9e97c325150502110c488` |
| Scope | hours contract + V2 canonical preflight + harness + Stage 03I-G audit doc |
| Secrets / Excel / migrations / prod writes in PR | none |

### Main tests

| Check | Result |
|---|---|
| `git diff --check` | PASS |
| `bunx tsc --noEmit` | PASS |
| `bun run build` | PASS |
| `bun test` | PASS — 4/0 |
| `bun run test:harness` | PASS — **52**/0/0 missing |
| `runtime-gates` on merge push | SUCCESS |

### Publish (single Lovable Update)

| Field | Value |
|---|---|
| PUBLISH_TIME (UTC) | `2026-07-29T04:11:05Z` |
| Lovable UI after Update | **Up to date** (one Update only) |
| LIVE_IMPORT_ASSET | `import-B5m2-8mX.js` |
| DEPLOYMENT_ID (sha256 of live import asset) | `635608c5385ea206a79a0ebbdf71047cd41c92f0af6892718341f495c90e1b07` |
| Live marker proof | `teachingHoursContractBlockers`, `تعارض ساعات المصدر`, `_component_weekly_hours`, `CO_TEACHING_HOURS_OVER_ALLOCATED` present in live import chunk |
| Migrations / DB writes / secrets during publish | **none** |

### Preview + dry-run only (same workbook; **no import confirm**)

`FILE_SHA256 = fbc23368ca36af452935ab086e239fff5b61bae668dd9be5887b330143a35098`

| Metric | Pre-PR113 (03I-F/G) | Post-PR113 (this run) |
|---|---:|---:|
| SOURCE_ROWS | 131 | **131** |
| EXPANDED_ROWS | 314 | **313** |
| READY_SOURCE_ROWS | 156 | **93** |
| CANONICAL_IMPORT_OPERATIONS | 138 | **87** |
| IDENTICAL_DUPLICATE_GROUPS | 8 | **6** |
| CONFLICTING_DUPLICATE_GROUPS | 4 | **0** |
| CONFLICTING_SOURCE_ROWS | 10 | **0** |
| AMBIGUOUS (expanded outcomes) | 18 | **88** |
| OVERALLOCATED_INSTRUCTORS (workload gate) | 0 | **0** |
| INVALID_TEACHING_HOURS / contract blockers | (server abort only) | **2** (`CO_TEACHING_HOURS_OVER_ALLOCATED` ×2) |
| DUPLICATE_CANONICAL_KEYS | 0 | **0** |
| CONFLICTING_KEYS_INCLUDED | 0 | **0** |
| LEGACY_INCLUDED_IN_PREFLIGHT | 0 | **0** |
| DRY_RUN_VALID | false (server) | **false** (client preflight now catches co-teach) |
| V2_ASSIGNMENTS | 0 | **0** |
| LEGACY_ASSIGNMENTS | 174 | **174** |

### Hours validation interpretation

1. **Single-component Excel≠weekly** now resolves to `AMBIGUOUS` (contract fix live) — those ops left the former 138 set.
2. **FR231 co-teach** (EMP012+EMP017, regular+parallel) still enters canonical with full hours each → **2** client `CO_TEACHING_HOURS_OVER_ALLOCATED` blockers; Confirm remains disabled.
3. Legacy is **not** in V2 preflight; terms and study systems remain keyed separately.
4. No import attempted. Database writes this mission: **0**.

### Count required for next approval

- Historical target **138** is no longer a dry-run-valid payload under the fixed contract until TEST source hours are remediated (split co-teach + align Excel totals to component weekly, or an explicitly approved new count).
- Current safe preview surface: **87** canonical ops with **2** remaining hour blockers → not import-ready.
- Next approval: TEST hours remediation + re-preview, then controlled import re-approval of the **new** dry-run-valid canonical count.

### FINAL_DECISION (03I-H)

`HOLD_WITH_ONE_EXACT_TEACHING_HOURS_RELEASE_BLOCKER`

Exact blocker: live contract correctly rejects the unremediated TEST hours (co-teach over-allocation in remaining payload; former Excel>weekly rows now AMBIGUOUS). Not ready for 138 import re-approval.

## Security Review

| Item | Value |
|---|---|
| Files changed (this docs update) | this report only |
| Migrations / RLS / RPCs | no (PR113 also: no) |
| Did this mission write production DB? | **no** |
| Production V2 rows created | 0 |
| Legacy changed | no |
| Secrets / Excel / backups in git | no |
| Lovable publish | **one** Update; no migrations/secrets |
| Production risk | low (frontend contract only; no DB mutation) |
| Ready for merge (docs) | yes (draft PR #112) |
| Ready for deploy | already published to live for PR113 |
