# STAGE-03A — Controlled Reconciliation Package

Mission: `PLATFORM-LAUNCH-STAGE-03A-CONTROLLED-RECONCILIATION-PACKAGE-01`
Generated: 2026-07-28 (Asia/Riyadh)
College: ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8`
Production: `emzytxqkxjjhsivqxdiu`
Baseline main: after merge of docs PR #97 + #99 and source PR #101 (`91f340d`)
Live deployment (pre-Stage-03A release): `d8a28b82b1d73a02518dc2c5716a7f882b527a719e224a6356daa3e19fa801ac`

**Scope of this package:** planning only. No production write. No migration apply. No history repair.

Primary live evidence source: `docs/PLATFORM-LAUNCH/CURSOR-PRODUCTION-READONLY-INVENTORY-01.md`
Audit source (must be matched to main/live): K3 `PLATFORM-LAUNCH-GAP-AUDIT-K3-01.md` on PR #98 (not merged)
Code evidence: `origin/main` after PR #101 (source remediation + V2 auto-schedule).
Source remediation report: `docs/PLATFORM-LAUNCH/CODEX-STAGE-03A-SOURCE-REMEDIATION.md`

---

## FINAL_DECISION

`STAGE_03A_READY_FOR_CONTROLLED_APPLY_APPROVAL`

The package is complete for operator approvals. Source fail-closed / importer / V2 scheduler gaps from PR #101 are merged on main. Apply itself is blocked until the approvals listed in `REQUIRED_USER_APPROVALS` are signed. Headcount apply payloads are intentionally empty because no **authorized 2026–2027** official counts exist yet (prior-year `students_*` files are candidates only).

---

## VERIFIED_ISSUE_REGISTER

### CLOSED_ITEMS

| ID | Prior claim | Evidence now | Decision |
|---|---|---|---|
| `C-STRUCTURE` | programs/levels/plans/cohorts incomplete | 4/4 programs, 16/16 levels, 4/4 active plans, 64/64 cohorts | CLOSED |
| `C-ROOM-BASE` | rooms invalid | 19 active rooms, positive capacity | CLOSED |
| `C-SCHEDULE-EMPTY` | bad published schedule | 0 versions / 0 sessions | CLOSED |
| `C-LIVE-DEPLOYMENT` / K3 `P0-LIVE-DEPLOY-STALE` | live stale vs main | live `x-deployment-id` matches Stage 01/02 published build; PR #95 fingerprints live | CLOSED |
| `P0-MIG-HISTORY-READ` / K3 `P0-MIGRATION-DRIFT-UNVERIFIED` (read half) | history unreadable | Lovable Cloud SQL: 75 `schema_migrations` rows; `UNKNOWN=0` | CLOSED (read) |
| Headcount twin `20260724002013`/`…012` | conflict | UUID twin MATCHED | CLOSED |
| `20260721180000` | maybe apply | NOT_APPLIED / SUPERSEDED / MUST_NOT_REAPPLY | CLOSED as decision |
| K3 claim “Sem2 cohorts missing” | risk | 32/32 Sem2 present | REJECTED_AS_FALSE_POSITIVE |
| K3 claim “plans/levels absent” | risk | all present | REJECTED_AS_FALSE_POSITIVE |
| `P1-READINESS-BASE-FAILOPEN` / K3 `P0-READINESS-FAILOPEN` | base readiness fail-open | PR #101 throws `READINESS_QUERY_FAILED` / `NEW_FLOW_READINESS_QUERY_FAILED` | CLOSED (source) |
| `P1-SCHEDULER-ERROR-SWALLOW` | greedy swallowed query errors | PR #101 throws relation-specific errors; `/auto-schedule` uses `runV2AutoSchedule` (no `section_id`) | CLOSED (source) |
| Importer carry-forward / expand_all / alias guessing | source bugs | PR #101 fixed; harness + anonymized fixture | CLOSED (source) |

### CONFIRMED_P0

| ID | Evidence | Why still P0 | Package |
|---|---|---|---|
| `P0-HEADCOUNT-59` | 5/64 approved; 59 missing | fail-closed readiness / DG generation gate | HEADCOUNT_PACKAGE |
| `P0-ROOMTYPE-233` | 233/307 timetabled components null `required_room_type_id` | INVALID_DATA for most cells; DG/schedule unsafe | prerequisite before DG/TA |
| `P0-TA-V2-ZERO` | 174 Legacy TA; 0 V2; 37 excess composite rows | New Flow scheduler needs V2 assignments | ASSIGNMENT_IMPORT_PACKAGE |
| `P0-IMPORT-PREVIEW-BLOCKED` (was K3 `P0-IMPORT-REAL-FILE`, narrowed) | real workbook present; preview still blocked by catalog/DG/course gaps (parser source bugs closed) | cannot import until catalog+DG gates clear | ASSIGNMENT_IMPORT_PACKAGE |

### CONFIRMED_P1

| ID | Evidence | Notes |
|---|---|---|
| `P1-DG-48` | 48/64 cells have 0 delivery groups (CYB has 181 groups) | after approved HC + room types |
| `P1-ROOM-COVERAGE` | cyber/network room types exist; rooms typed generic `computer_lab` | facilities decision |
| `P1-WORKBOOK-ALIASES` | remaining campus/unknown labels after exact-alias fix | explicit alias policy for leftover labels |
| `P1-INSTRUCTOR-DEPT-46` | 46/88 instructors missing `department_id` | HR/college master |
| `P1-PUBLISH-HARDENING` (K3 `P0-PUBLISH-GATE-MISSING`, reclassified) | `transition_schedule_version` **present** in production catalog; RLS direct-status bypass still needs negative live proof | DOCUMENT + negative RPC/RLS test in Stage 03B; not “missing RPC” anymore |
| `P1-HEADCOUNT-NOT-CONSUMED` | capacity still needs approved headcount wiring in placement | after HC load |
| `P1-LEGACY-SECTION-ID` | 174 Legacy `section_id` assignments live | Legacy untouched; V2 independent |

### CONFIRMED_P2

| ID | Evidence | Notes |
|---|---|---|
| `P2-TIME-TEMPLATE-OVERLAP` | 67 active `time_slot_templates`; overlap scan: 1 EXACT_DUPLICATE, 201 INTENTIONAL_OVERLAP (2h/3h/`both` candidates). Inventory’s 139 = same-system subset | TIME_TEMPLATE_PACKAGE |
| `P2-AVAILABILITY-SPARSE` | 0 instructor availability; 1 room availability | load after schedule pilot policy |
| `P2-STUDY-SYSTEM-BOTH` | `both` templates widen candidate windows | document invariant; fix only if invalid placements observed |

### REJECTED_AS_FALSE_POSITIVE

| Claim | Why rejected |
|---|---|
| Live deploy still on `71b93a56…` | replaced by `d8a28b82…` |
| Migration history inaccessible ⇒ objects absent | PostgREST non-exposure ≠ absence; Cloud SQL proved 75 rows |
| `20260724002013` history-without-objects | objects MATCHED via UUID twin |
| Structural foundation missing | 4/16/4/64 proven |
| All K3 P0s remain P0 as written | publish RPC missing & live stale & migration unread are closed or reclassified |

**Counts:** CLOSED=12 · CONFIRMED_P0=4 · CONFIRMED_P1=7 · CONFIRMED_P2=3 · FALSE_POSITIVE=5

---

## HEADCOUNT_PACKAGE

### Current state

| Metric | Value |
|---:|
| Active cohorts | 64 |
| Approved headcounts | 5 (CYB Sem1 subset) |
| Missing approved | 59 |
| Official 2026–2027 sources authorized for apply | **0** |
| Prior-year `students_*` candidate files in Downloads | 37 files; 34 cells have a filename match |

### Classification of 59 missing cells

| Class | Count | Rule |
|---|---:|---|
| `OFFICIAL_COUNT_AVAILABLE` | **0** | requires authorized 2026–2027 source with cohort mapping |
| `COUNT_SOURCE_MISSING` | **59** | no authorized year-matched source |
| `INVALID_EXISTING_COUNT` | 0 | no unapproved draft rows observed for the 59 |
| `TEST_ONLY_REQUIRED` | 0 | launch needs official counts |

**Prior-year candidates (not apply-ready):** 34 of 59 have `students_{prog}_level_{n}_{system}_*_2025_2026_second*.xlsx` (often `*_prepared`). These are **2025–2026 Sem2** extracts. Using them for **2026–2027** requires an explicit operator year-carry policy. Until then classification remains `COUNT_SOURCE_MISSING`.

**25 cells with no matching students file** (examples): CIS/CS/IT/CYB parallel at levels 2–4; several CYB Sem1 gaps already partially filled by the 5 approved rows.

### Approved rows (do not re-upsert blindly)

Retain the five approved CYB Sem1 rows already in `scheduling_cohort_term_headcounts` (inventory table). Any change needs a new source attribution.

### Apply payload status

`HEADCOUNTS_READY_FOR_APPLY = 0`
No RPC payload file is generated with numbers. Template for Stage 03B once sources are approved:

```text
RPC: upsert_scheduling_cohort_term_headcount
Args: p_cohort_id, p_term_id, p_registered_student_count, p_eligible_student_count,
      p_expected_attendance_count, p_reserve_margin, p_scheduling_headcount,
      p_exam_eligible_count, p_source, p_notes, p_allow_over_eligible
Then: approve_scheduling_cohort_term_headcount(p_id, p_notes)
```

Each future row must carry: `source_file`, `source_row`, before/after expected counts, and college manage permission.

### Stop condition

Do not call upsert/approve until `OFFICIAL_COUNT_AVAILABLE > 0` under signed year policy.

---

## CURRICULUM_PACKAGE

| Metric | Value |
|---:|
| Cells with offerings (program×level×term×system) | **64 / 64** |
| Cells needing first-time `generate_cohort_curriculum` | **0** |
| Refresh batches (optional, plan-change only) | 0 planned |

RPC: `generate_cohort_curriculum(p_cohort_id uuid)` — idempotent refresh only if plan/components changed.
**Do not** generate summer_training as timetabled; **do not** invent project hours.

`CURRICULUM_BATCH_COUNT = 0` for mandatory apply.

---

## DELIVERY_GROUP_PACKAGE

| Metric | Value |
|---:|
| Delivery groups now | 181 (CYB only) |
| Cells with DG | 16 |
| Cells needing `generate_cohort_delivery_groups` | **48** |

RPC: `generate_cohort_delivery_groups(p_cohort_id uuid)`
Client preflight (must pass): approved headcount via `resolve_scheduling_headcount`, component room types present.

Atomic batch plan (not executed): one transaction/job per college wave of N cohorts after HC+room-type gates; verify same-college, regular/parallel isolation, no Legacy `section_id` creation, exclude non-timetabled summer training, exclude 0h project from standard workload per existing generator rules.

Expected before/after (illustrative): DG rows `181 → 181+Δ` where Δ is generator output for 48 cells (exact Δ depends on headcounts and components; recompute in Stage 03B dry-run).

`DELIVERY_GROUP_BATCH_COUNT = 48` (planned calls; blocked on HC + room types).

---

## ASSIGNMENT_IMPORT_PACKAGE

### Source workbook (read-only)

| Field | Value |
|---|---|
| File | `Downloads/b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx` |
| Sheets | `اسناد الفصل الاول 2026`, `اسناد الفصل الثاني 2026` |
| SOURCE_ROWS | ~129–131 raw rows/sheet (inventory used 131 combined preview outcomes); non-empty JSON rows ~82/sheet |
| READY_EXPECTED | **0** until alias/course/component/DG blockers cleared |
| BLOCKED_EXPECTED | dominant (course_not_found, unknown_program, ambiguous_*, DG missing) |
| AMBIGUOUS_EXPECTED | component + instructor classes from inventory |
| NOT_FOUND_EXPECTED | course_not_found cluster |
| CONFLICT_EXPECTED | 0 V2 conflicts today (no V2 rows) |

### Production TA state

| Metric | Value |
|---:|
| Total TA | 174 |
| V2 (`delivery_group_id`) | 0 |
| Legacy (`section_id`) | 174 |
| Duplicate composite keys | 32 keys / **37** excess rows |
| Dup classification | `LEGACY_SECTION_COMPOSITE_DUP` (all keys have NULL delivery_group) |

### Transition plan (mandatory)

1. Legacy remains untouched (no delete, no rewrite).
2. V2 imported independently via `commit_teaching_assignments_v2_import` / `commit_import_job_atomic`.
3. No cross-link Legacy↔V2.
4. No silent replacement.
5. No duplicate V2 (`insert_only` first wave).
6. Rollback by import job/run id (`replay` / compensating archive), not by TRUNCATE.

### Import execution package status

Prepared as **plan only**. Do not preview-commit until: aliases approved, room types fixed, DG present for target cells, preview READY>0 with zero unexplained blockers.

K3 expand_all hours bug / program carry-forward: still treat as **source-risk** to re-verify on a dry preview against this workbook before any commit (Stage 03B gate).

---

## TIME_TEMPLATE_PACKAGE

| Metric | Value |
|---:|
| Active templates | 67 |
| Overlap pairs (this scan) | 202 |
| `EXACT_DUPLICATE` | **1** |
| `INTENTIONAL_OVERLAP` | 201 (shifted 2h/3h and `both` windows) |
| `DIFFERENT_STUDY_SYSTEM` | 0 in overlapping-time same-day filter without both |
| `INVALID_OVERLAP` | 0 confirmed without dependency analysis |
| `FALSE_POSITIVE` | inventory 139 vs 202 = different inclusion of `both`/duration variants |

Operational reference: Sat–Thu; 08:00–14:00 regular; parallel evening windows; systems isolated.

### Repair plan (not executed)

| Action | Count | Rule |
|---|---:|---|
| templates retained | 66+ | default |
| deactivate exact duplicate | 1 pair → keep one | only after confirming zero session/availability FK |
| consolidate intentional overlaps | 0 now | treat as candidate windows unless operator marks invalid |
| affected sessions | 0 | no sessions exist |
| affected availability | minimal | 1 room availability row |
| rollback mapping | reactivate deactivated id | document id pair |

`TIME_TEMPLATE_REPAIRS = 1` exact-duplicate decision + policy doc for intentional overlaps.

---

## MIGRATION_RECONCILIATION_PACKAGE

No apply. No history repair in this stage.

| Item | Decision | Notes |
|---|---|---|
| `20260724002013` ↔ local `20260724002012_99172989-…` | `NO_ACTION` / `DOCUMENT_ONLY` | MATCHED UUID twin |
| `20260721180000` headcount original | `MUST_NOT_REAPPLY` | superseded |
| program/department integrity objects | `HISTORY_BACKFILL_REQUIRED` (later) | `ensure_prog_college` + `prog_check_college` present; no history row |
| `generate_cohort_curriculum` / `approve_capacity_split_proposal` | `HISTORY_BACKFILL_REQUIRED` (later) | objects present |
| Jul19 UUID applied-copies without local filenames | `DOCUMENT_ONLY` | history present; map to source_only/feature twins |
| Empty history stamps `20260715200200/500/600` | `DOCUMENT_ONLY` then investigate | PARTIAL rows |
| `ss_*` conflict helpers | `SOURCE_MIGRATION_REQUIRED` (deferred) | 0 `ss_%` procs; apply only if conflict runtime demands |
| Legacy write hardening `20260721090000` | `SOURCE_MIGRATION_REQUIRED` (deferred) | after Legacy disposition |
| Availability `20260720120000` | `SOURCE_MIGRATION_REQUIRED` (deferred) | after availability policy |

### History backfill stub (not executed)

For each `HISTORY_BACKFILL_REQUIRED` item, Stage 03B must supply: exact version, exact name, statements evidence (md5 of intended SQL), safety proof (objects already equal), rollback (delete inserted history row only with dual approval), and explicit **reason not to re-apply SQL**.

`MIGRATION_HISTORY_ACTIONS = 3` backfill candidates + `1` MUST_NOT_REAPPLY + several DOCUMENT_ONLY.

---

## EXECUTION_ORDER

Single order (matches Stage 03B runbook):

1. Source fixes merged and deployed (readiness fail-closed, importer dry-preview green, scheduler input fail)
2. Migration/history reconciliation **if** signed (backfill only; no blind DDL)
3. Headcounts (official sources only)
4. Curriculum refresh **only if** plan drift
5. Delivery groups (48 cells)
6. Time templates (exact duplicate policy)
7. Teaching assignments V2 import
8. Readiness verification (64-cell matrix)
9. Experimental schedule
10. RBAC/RLS negative proofs
11. Launch / publish gate

Each step’s preflight / write set / expected counts / post-verify / rollback / stop condition: see `STAGE-03B-PRODUCTION-APPLY-RUNBOOK.md`.

---

## EXPECTED_COUNTS

| Gate | Before | After successful Stage 03B (target) |
|---|---:|---:|
| Approved headcounts | 5 | 64 |
| Cells with DG | 16 | 64 |
| V2 teaching assignments | 0 | >0 covering READY cells |
| Legacy TA | 174 | 174 (unchanged) |
| Null room-type timetabled components | 233 | 0 |
| READY cells | 0 | pilot subset ≥ agreed N |
| Exact duplicate templates | 1 pair | 0 unresolved |

---

## ROLLBACK_MATRIX

| Write | Rollback |
|---|---|
| Headcount upsert/approve | prior row snapshot / revision table; re-approve previous |
| DG generate | generator idempotency + obsolete flag; no hard delete without map |
| TA V2 import | import job id / insert_only inverse archive |
| Template deactivate | reactivate saved id |
| History backfill | delete inserted schema_migrations row only with dual control |
| Schedule experimental | delete/archive experimental version only; never touch official |

---

## REQUIRED_USER_APPROVALS

1. Year policy for prior-year student files **or** delivery of 2026–2027 official headcount workbook.
2. Alias/campus policy for six unmatchable labels.
3. Room-type assignment for 233 components + lab reclassification.
4. Approval to generate DGs for 48 cells after HC.
5. Approval to import V2 TA with Legacy untouched.
6. Template exact-duplicate keep/drop choice.
7. Any history backfill (separate from DDL).
8. Experimental schedule creation (later).

---

## RELEASE_GATES

- No production apply from Stage 03A alone.
- Stage 03B runbook must be followed step-by-step with stop conditions.
- PR #98 (K3 audit) remains open / unmerged by design (audit trail; claims reconciled here).
- Docs PR #97 and #99 merged into main as non-conflicting documentation.
- Source PR #101 merged (`91f340d`); Lovable publish of that main is required before treating live UI as remediated.
- Step 1 of EXECUTION_ORDER (source fixes) is satisfied on main; remaining gates are data + live verify.
