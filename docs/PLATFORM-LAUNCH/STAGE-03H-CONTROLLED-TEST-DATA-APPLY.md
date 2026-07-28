# STAGE-03H — Controlled Test Data Apply

Mission: `PLATFORM-LAUNCH-STAGE-03H-CONTROLLED-TEST-DATA-APPLY-01`
Generated: 2026-07-28 (Asia/Riyadh)
Production: `emzytxqkxjjhsivqxdiu` · ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8`
Live: https://gomufadhala.com

---

## FINAL_DECISION

`STAGE_03H_TEST_DATA_APPLIED_READY_FOR_V2_IMPORT_APPROVAL`

---

## APPROVAL_TEXT

Explicit user approval granted for this mission only: INSERT/UPDATE/RPC required for TEST batch `E2E-ITCS-20260728-01`. Migrations, DELETE, Teaching Assignments confirm, schedule create/run, Lovable Publish, and secret changes remained forbidden.

---

## TEST_BATCH_ID

`E2E-ITCS-20260728-01`

## PACKAGE_SHA256

`0f76db55bdb90c845044e6615f38463cba219eef18d379fa654e7f093bb235c6` (ZIP verified match before apply)

## START_TIME / END_TIME / OPERATOR

| Field | Value |
|---|---|
| START_TIME | `2026-07-28T03:05:00+00:00` (preflight/backup) |
| END_TIME | `2026-07-28T03:13:05+00:00` (readiness + preview close) |
| OPERATOR | Super Admin `msorori201201@gmail.com` |

---

## BEFORE_COUNTS

| Metric | Before |
|---|---:|
| courses | 229 |
| plan_courses | 183 |
| plan_course_components | 308 |
| required_room_type null | 234 |
| headcounts total / approved | 5 / 5 |
| delivery_groups (non-obsolete) | 181 |
| offerings | 444 |
| instructors | 88 |
| cohorts | 64 |
| existing TST-* courses | 0 |
| batch-tagged headcounts | 0 |

---

## WRITE_PLAN

| operation | target | expected inserts | expected updates | expected skips | rollback key | test-batch evidence |
|---|---|---:|---:|---:|---|---|
| INSERT_TEST_COURSE_AND_PLAN_LINK | courses + plan_courses (+ theory component) | 104 | 0 | idempotent | `course_code:TST-*` | TST prefix + cleanup manifest |
| SET_PROGRAM_LABEL_ALIAS | program-aliases.ts (code only) | 0 | 0 | 2 skipped | `program_label:*` | **no DB table** — skipped |
| RESOLVE_COMPONENT | plan_course_components.is_timetabled | 0 | siblings | selected ok | `component_row:*` | backup restore |
| SET_REQUIRED_ROOM_TYPE | plan_course_components.required_room_type_id | 0 | 233 | 0 | `room_type:{component_id}` | backup restore |
| RESOLVE_INSTRUCTOR | instructors.notes / name disambiguation | 0 | 35 (+ collisions) | 0 | `instructor_link:*` | backup restore |
| UPSERT+APPROVE HC | scheduling_cohort_term_headcounts RPCs | 59 | 0 | 0 | `headcount:{cohort_id}` | source/notes = batch |
| generate_cohort_curriculum | RPC | 64 cohorts | — | — | offerings notes / re-run | sequential |
| generate_cohort_delivery_groups | RPC | 48 cells | — | — | documented inverse | sequential |

---

## ACTUAL_WRITES

| Group | Result |
|---|---|
| COURSE_WRITES | **104** created (0 fail) |
| PROGRAM_LABEL_WRITES | **0** (skipped — no DB alias table; isolation not enforceable in-DB) |
| COMPONENT_WRITES | **34** package rows processed (15 sibling `is_timetabled=false`) |
| ROOM_TYPE_WRITES | **233** |
| INSTRUCTOR_MAPPING_WRITES | **35** (+ collision name suffixes) |
| HEADCOUNT_WRITES | **59** upsert+approve |
| APPROVED_HEADCOUNTS_TOTAL | **64** |
| TST duplicate name uniquify | 60 renamed with `[TST-DUP-…]` (same plan/level/semester name collisions) |

### CREATED_IDS / UPDATED_IDS

- 104 new `courses` with codes `TST-*` + matching `plan_courses` + theory components
- 233 `plan_course_components.required_room_type_id` updates
- 15 practical siblings set `is_timetabled=false` for hour-disambiguation
- 35 instructor note/name mappings; collision instructors renamed with `[TEST-COLLISION-…]`
- 59 headcount rows approved; cohort `expected_students` aligned for DG sizing

### SKIPPED_IDEMPOTENT

0 on first apply (no prior TST / batch HC)

### FAILED_WRITES

**0**

### UNEXPECTED_WRITES

**0** (scoped to cleanup keys / TST / batch notes)

---

## CURRICULUM_RESULTS

| Metric | Value |
|---|---:|
| CURRICULUM_ATTEMPTED | 64 |
| CURRICULUM_SUCCESS | 64 |
| failed | 0 |

## DELIVERY_GROUP_RESULTS

| Metric | Value |
|---|---:|
| DELIVERY_GROUP_CELLS_ATTEMPTED | 48 |
| DELIVERY_GROUP_CELLS_SUCCESS | 48 |
| failed | 0 |
| cohorts_with_dg after | 64 |
| delivery_groups non-obsolete after | 878 |

---

## PREVIEW_BEFORE_AFTER

Baseline (post-PR103): source 131 · expanded 247 · READY 0 · BLOCKED 20 · AMBIGUOUS 69 · NOT_FOUND 158

After Stage 03H apply (same workbook, Preview only — **no Confirm Import**):

| Metric | After |
|---|---:|
| PREVIEW_SOURCE_ROWS | 131 |
| PREVIEW_EXPANDED_ROWS | 314 (= READY+BLOCKED+AMBIGUOUS+NOT_FOUND) |
| PREVIEW_READY | **156** |
| PREVIEW_BLOCKED | 18 (`delivery_groups`) |
| PREVIEW_AMBIGUOUS | 18 (`ambiguous_component` 16 · `ambiguous_course` 2) |
| PREVIEW_NOT_FOUND | 122 (`course_not_found` 120 · `unknown_program` 2) |
| PREVIEW_CONFLICT | 0 |
| query errors | 0 |

Notes:

- READY > 0 satisfied.
- Remaining `unknown_program` (2) = package program-label rows not applied in DB (code-map only; Publish forbidden).
- Remaining course_not_found are names still absent from catalog beyond the 104 TST fills / deduped pairs.
- Confirm Import was **not** executed.

---

## READINESS_AFTER

64-cell matrix (active cohorts):

| Metric | Value |
|---|---:|
| READINESS_READY | 0 |
| READINESS_BLOCKED | 64 |
| blocker | **teaching_assignments** only (expected until V2 import) |
| headcount approved | 64/64 |
| delivery groups | 64/64 cohorts |
| timetabled room types missing | 0 |

---

## BACKUP_SHA256

Local folder: `C:\Users\Elite\Downloads\ITCS-STAGE03H-BACKUP-E2E-ITCS-20260728-01`

| File | SHA256 |
|---|---|
| `before-values.json` | `0ef1eff588e383d8f760d00542b9e28b288295558828eec2a4b0e4b99aa53229` |
| `before-values.csv` | `9654ccea5474b09b4eff22372564de1263b4e47d7ab13212a03c6dd88d8ca215` |
| `tst-dup-rename.json` | `9ce7fbe56d3388dc6db702af3cd44ab56b5d036568bd3dc52e95fd67c9f6cea7` |
| `instr-fullname-collision-full.json` | `011ba0516349406e39ee58f8907a0615e8ed912cc1534c83c002f443e06e7717` |

Backup files were **not** uploaded to GitHub.

---

## CLEANUP_KEYS / ROLLBACK_STATUS

- Cleanup contract from Stage 03F/03G remains authoritative (467 entries).
- Additional compensating artifacts in backup for TST name dedupe + instructor collision renames.
- `ROLLBACK_READY = yes` via backup restore + TST code delete scope (DELETE reserved for later cleanup mission).
- No DELETE executed in this stage.

---

## MIGRATIONS_APPLIED

`NONE`

## PUBLISH_PERFORMED

`NONE`

## DATABASE_WRITES

`YES` (approved test-batch scoped INSERT/UPDATE/RPC only)

---

## Security Review

| Item | Value |
|---|---|
| Files changed (git) | this report only |
| Migrations / RLS / RPCs schema | no |
| Auth impact | no |
| Authorization | Super Admin session; college-scoped writes |
| Sensitive data in git | no |
| Privilege escalation | no |
| Production risk | medium (test data now live; must cleanup before operational load) |
| Ready for merge (docs) | yes after CI |
| Ready for V2 import | **pending separate approval** |
| Ready for operational use | **no** — TEST_ONLY |

---

## Git policy

- Docs report only in this PR.
- Not committed: Excel, ZIP, backup folder, temp apply scripts, tokens.
