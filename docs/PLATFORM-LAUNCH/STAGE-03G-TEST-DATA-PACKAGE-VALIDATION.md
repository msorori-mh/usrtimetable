# STAGE-03G — Test Data Package Validation

Mission: `PLATFORM-LAUNCH-STAGE-03G-TEST-DATA-PACKAGE-VALIDATION-01`  
Generated: 2026-07-28 (Asia/Riyadh)  
Scope: **local validation + dry-run simulation only — no production writes**  
TEST_BATCH_ID: `E2E-ITCS-20260728-01`  
DATA_CLASSIFICATION: `TEST_ONLY`  
Prior report: `docs/PLATFORM-LAUNCH/STAGE-03F-TEST-DATA-INTAKE-FILL.md` (PR #106)

**Hard bans honored:** no production INSERT/UPDATE/DELETE; no RPC/SQL apply; no migrations; no Lovable Publish; original empty intake untouched; Excel/ZIP not uploaded to GitHub.

---

## FINAL_DECISION

`STAGE_03G_TEST_DATA_VALIDATED_READY_FOR_APPLY_APPROVAL`

---

## PACKAGE_SHA256

| Artifact | SHA256 |
|---|---|
| `ITCS-OFFICIAL-DATA-INTAKE-TEST-FILLED.zip` | `0f76db55bdb90c845044e6615f38463cba219eef18d379fa654e7f093bb235c6` |

### Per-file SHA256 (filled folder)

| File | SHA256 |
|---|---|
| `00_README_AR.md` | `e6f286e1ccecf9911e13891bd37a55b8d112ce5cc809948c63c286a8e2f765a9` |
| `01_missing_course_catalog.xlsx` | `3e6cedcc01d362d0772a66ec28fd5cdecb5b0da77399016b2c255c5ebe5749c9` |
| `02_instructor_identity_resolution.xlsx` | `08185b2a6e49cd8fd4d28d00072d39dcc66761d036ceaeb0b9c8fc5d8dd6beb4` |
| `03_cohort_headcounts.xlsx` | `2729b8eead372c94e61e4964178468538aea7f6d94d654c95dcda9cd4356bcab` |
| `04_course_component_room_types.xlsx` | `da9b630ea7110906c91ec961b29d2de60f7bb834f1e40ce98ba0e1d42c34a591` |
| `05_program_label_clarifications.xlsx` | `4bbe378e945b9d35fd96ddae67d84f99c1912ce9ac29d5a72e6ed669b425e1fd` |
| `OFFICIAL-SOURCE-MANIFEST.csv` | `26da244f476c8ebff0613f0c285b8b034d79732fe15d6036e015990e9eb7fe8b` |
| `TEST-DATA-CLEANUP-MANIFEST.csv` | `d3285854eac275ab9c67af6162ae979551b67979737fd310aac2861fdb011b88` |
| `TEST-DATA-DECLARATION.md` | `94fcb1be67d47dd840ef74be8e804464df3a7af84e9db63360009dec4f62a74c` |

---

## FILE_VALIDATION

| Check | Result |
|---|---|
| Required files present | 9 / 9 |
| Workbooks openable | PASS |
| Sheet name (`data`) | PASS |
| Row counts | 104 / 35 / 59 / 267 / 2 |
| Unexpected `#REF` / `#VALUE` / `#N/A` | 0 |
| Unexpected formulas | 0 |
| WORKBOOKS_PASS | **true** |

---

## ORIGINAL_VS_FILLED_DIFF

Compared to `C:\Users\Elite\Downloads\ITCS-OFFICIAL-DATA-INTAKE`.

| Metric | Value |
|---|---:|
| ADDED_ROWS | 0 |
| DELETED_ROWS | 0 |
| PROTECTED_FIELDS_MODIFIED | 0 |

Protected fields checked: `record_id`, `cohort_id`, `component_id`, `program`, `level`, `term`, `study_system`, identity/current/options columns. Differences confined to FILL columns + Manifest/Declaration/Cleanup artifacts.

---

## PROTECTED_FIELDS

`MODIFIED_PROTECTED_FIELDS = 0`

---

## REFERENTIAL_INTEGRITY

Live read-only against production `emzytxqkxjjhsivqxdiu` / ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8` (JWT session; no writes).

| Check | Result |
|---|---|
| Program codes ∈ {cyb,cs,cis,it} (official fills) | PASS |
| Instructor employee numbers ∈ live instructors (88) | PASS (35/35) |
| Room type fills ∈ {lecture_hall,computer_lab,network_lab,cybersecurity_lab} | PASS (233/233) |
| Ambiguous component UUID ∈ available_options | PASS (34/34) |
| TST course codes unique + pattern-consistent | PASS |
| regular/parallel not mixed on same fill identity | PASS |
| cohort_id ∈ live academic_cohorts (64) | PASS (59/59) |
| INVALID_REFERENCES | **0** |

---

## HEADCOUNT_VALIDATION

| Check | Result |
|---|---|
| registered > 0 | PASS |
| eligible ≤ registered | PASS |
| expected_attendance ≤ registered | PASS |
| reserve_margin ≥ 0 | PASS |
| scheduling_headcount ≤ registered | PASS |
| exam_eligible ≤ eligible | PASS |
| integers only / no negatives | PASS |
| unique cohort_id | PASS |
| INVALID_HEADCOUNTS | **0** |

Distribution: 59 rows across `program × level × term × study_system` (each key count = 1). Programs cyb/cs/cis/it; terms Sem2 / 2026-T1; systems regular/parallel covered.

---

## COURSE_VALIDATION

| Check | Result |
|---|---|
| Rows | 104 |
| Unique course codes | 104 |
| All codes `TST-*` | 104 |
| Pattern `TST-{PROG}-L{level}-{S1\|S2}-{nnn}` | PASS |
| Name matches source `current_value` | PASS |
| TEST_ONLY markers | PASS |
| INVALID_COURSES | **0** |

---

## COMPONENT_VALIDATION

| Check | Result |
|---|---|
| Ambiguous components resolved (type + hours + option UUID) | 34 |
| Room types assigned | 233 |
| Excluded zero-hour / project / summer training documented | PASS |
| Practical → lecture_hall without TEST_ONLY exclusion | 0 |
| INVALID_COMPONENTS | **0** |

---

## INSTRUCTOR_VALIDATION

| Check | Result |
|---|---|
| Rows | 35 |
| Distinct employee numbers used | 4 |
| Max assignments / emp | 10 |
| Avg assignments / emp | 8.75 |
| Same normalized name → multiple emp without justification | 0 |
| Missing employee number | 0 |
| Empty required alias | 0 |
| TEST_ONLY on all rows | PASS |
| INVALID_INSTRUCTORS | **0** |

---

## CLEANUP_VALIDATION

| Check | Result |
|---|---|
| CLEANUP_ENTRIES | 467 |
| Coverage of template record_ids | **100%** |
| cleanup_key non-empty | PASS |
| test_batch_id = `E2E-ITCS-20260728-01` | PASS |
| future_cleanup_action = `DELETE_BEFORE_OPERATIONAL_DATA` | PASS |
| Non-test `course_code:` keys | 0 |
| Cleanup scope test (batch-only delete) | **PASS** |

Scope proof: filtering `test_batch_id = E2E-ITCS-20260728-01` selects all 467 cleanup rows and zero foreign probe keys; no operational course codes targeted.

---

## DRY_RUN_COUNTS

Local payload simulation only — **no production RPC/SQL**.

| Expected apply effect | Count |
|---|---:|
| courses created (TST) | 104 |
| courses updated/aliased (non-TST) | 0 |
| aliases added | 104 |
| instructor mappings | 35 |
| headcounts created/approved | 59 |
| components updated | 34 |
| room types assigned | 233 |
| program labels mapped | 2 |
| curriculum generations | 0 (out of package) |
| delivery group generations | 0 (out of package / deps later) |
| duplicate write keys | 0 |

---

## IDEMPOTENCY_RESULT

`PASS` — unique apply keys; replay set size equals first-pass set; `duplicate_writes = 0`.

---

## ROLLBACK_RESULT

`PASS` — cleanup manifest complete (100% coverage), all keys batch-scoped, action `DELETE_BEFORE_OPERATIONAL_DATA`. Rollback package sufficient to remove this test batch without touching non-batch rows.

---

## BLOCKERS

None.

---

## Git policy

- Docs report only in this PR.
- **Not committed:** Excel, ZIP, filled package, temp validation scripts, session tokens.

---

## Security Review

| Item | Value |
|---|---|
| Files changed | this report only |
| Migrations change? | no |
| RLS change? | no |
| RPCs change? | no |
| Authentication impact | no |
| Authorization impact | no |
| Sensitive data exposure | no (TEST_ONLY metrics; no secrets committed) |
| Privilege escalation risk | no |
| Production risk | none (read-only validation + dry-run) |
| Ready for merge (docs) | yes after CI |
| Ready for production apply | **no** — requires separate explicit apply approval |
| Production writes performed | **none** |
