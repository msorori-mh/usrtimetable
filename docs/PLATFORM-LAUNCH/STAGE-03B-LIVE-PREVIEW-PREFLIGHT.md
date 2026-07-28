# STAGE-03B — Live Preview Preflight

Mission: `PLATFORM-STAGE-03B` resume — **preview + documentation only**
Generated: 2026-07-28 (Asia/Riyadh)
Production: `emzytxqkxjjhsivqxdiu` · College ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8`
Live deployment (at time of check): `9c454133634e82aa8a9dc3cde8a6bcea27737c29bf6513315b0328016617f0d4`
Workbook: `C:\Users\Elite\Downloads\b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx`
Operator session: Super Admin (`msorori201201@gmail.com`) on https://gomufadhala.com

**Hard bans honored:** no import confirm, no DB writes, no migrations, no Publish, no delivery-group generation, no schedule create/run.

---

## FINAL_DECISION

`STAGE_03B_PREFLIGHT_COMPLETE_READY_FOR_CONTROLLED_DATA_APPLY`

Preview evidence is complete. Controlled data apply remains blocked by catalog / headcount / delivery-group gaps (not by missing preview).

---

## Method

1. Opened authenticated live session; confirmed `/import` with entity **الإسناد التدريسي V2** and study-system scope **المنتظم والنفقة الخاصة (`both`)**.
2. Native OS file-picker automation is blocked in this agent environment (CDP filesystem-backed `input[type=file]` denied).
3. Therefore Preview was executed with the **same production JWT session** and the **identical** client path used by the UI Preview button:
   - `parseSourceWorkbookFile`
   - `resolveSourceTeachingAssignments` / `previewSourceWorkbookImport` semantics
   - live PostgREST reads for instructors, programs, courses, plans, components, cohorts, delivery groups
4. Sheet→term map (live codes):
   - `اسناد الفصل الاول 2026` → `2026-T1` (`term_type=first`)
   - `اسناد الفصل الثاني 2026` → `Sem2` (`term_type=second`)
5. `/data-readiness` opened in the same session for UI corroboration (read-only).

No `commit_teaching_assignments_v2_import` / confirm click occurred.

---

## Row-count verdict (131 vs 262)

| Concept | Count | Meaning |
|---:|---:|---|
| Raw Excel matrix rows (incl. blanks/headers noise) | ~130 + ~132 | Not the academic source count |
| Parser ignored / non-data rows | 63 + 66 | Blank / incomplete matrix lines |
| **TOTAL_SOURCE_ROWS (authoritative)** | **131** | Parsed academic data rows (66 Sem1 + 65 Sem2) |
| TOTAL_EXPANDED_ROWS (resolver outcomes) | **265** | After component/`expand_all` fan-out (Sem1 129 + Sem2 136) |
| Successful MATCHED expansions | **0** | `expandedAssignments = 0` |

**Verdict:** the real source total is **131**, not ≈262. The ≈262 figure was a mistaken double-count of raw matrix lines (or conflating raw+parsed). Expansion increases *outcome* rows to **265**, but none are READY/MATCHED yet.

---

## Per-sheet preview

### Sem1 — `اسناد الفصل الاول 2026`

| Metric | Value |
|---|---:|
| Source data rows | **66** |
| Parsed / analyzed source rows | **66** |
| READY (MATCHED) | **0** |
| BLOCKED | **10** |
| AMBIGUOUS | **24** |
| NOT_FOUND | **95** |
| CONFLICT | **0** |
| DUPLICATES (matched-key excess) | **0** |
| Resolver outcome rows (post-expand attempts) | 129 |

Reasons (Sem1):

| Reason | Count |
|---|---:|
| `course_not_found` | 94 |
| `ambiguous_component` | 16 |
| `delivery_groups` | 10 |
| `ambiguous_instructor` | 8 |
| `unknown_program` | 1 |

### Sem2 — `اسناد الفصل الثاني 2026`

| Metric | Value |
|---|---:|
| Source data rows | **65** |
| Parsed / analyzed source rows | **65** |
| READY (MATCHED) | **0** |
| BLOCKED | **14** |
| AMBIGUOUS | **29** |
| NOT_FOUND | **93** |
| CONFLICT | **0** |
| DUPLICATES (matched-key excess) | **0** |
| Resolver outcome rows (post-expand attempts) | 136 |

Reasons (Sem2):

| Reason | Count |
|---|---:|
| `course_not_found` | 92 |
| `ambiguous_component` | 20 |
| `delivery_groups` | 14 |
| `ambiguous_instructor` | 9 |
| `unknown_program` | 1 |

---

## Combined preview totals

| Metric | Value |
|---|---:|
| SEM1_SOURCE_ROWS | 66 |
| SEM2_SOURCE_ROWS | 65 |
| TOTAL_SOURCE_ROWS | **131** |
| TOTAL_EXPANDED_ROWS | **265** |
| READY | **0** |
| BLOCKED | **24** |
| AMBIGUOUS | **53** |
| NOT_FOUND | **188** |
| CONFLICT | **0** |
| DUPLICATES | **0** |

### MAIN_BLOCKERS (combined, non-READY outcomes)

| Reason | Count |
|---|---:|
| `course_not_found` | **186** |
| `ambiguous_component` | **36** |
| `delivery_groups` | **24** |
| `ambiguous_instructor` | **17** |
| `unknown_program` | **2** |

Classification mapping used (no guessing of values):

- READY ← resolver `MATCHED`
- BLOCKED ← resolver `BLOCKED` (dependency, e.g. `delivery_groups`)
- AMBIGUOUS ← resolver `AMBIGUOUS`
- NOT_FOUND ← resolver `ERROR` with not-found/unknown/missing codes (dominantly `course_not_found`)
- CONFLICT ← conflict/duplicate/over-alloc codes (**none observed**)
- DUPLICATES ← excess among MATCHED composite keys (**none**; no MATCHED rows)

---

## Data readiness (live, read-only)

### Cell matrix (program×level×term×system = 64 active cohorts)

| Metric | Value |
|---|---:|
| READINESS_READY | **0** |
| READINESS_BLOCKED | **64** |

Primary block drivers (cohort cells; a cell may carry multiple reasons):

| Reason | Cells affected |
|---|---:|
| `missing_approved_headcount` | 59 |
| `missing_delivery_groups` | 48 |
| `missing_teaching_assignments_v2` | 16 (CYB cells with DG but no V2 TA) |

### UI corroboration (`/data-readiness`)

Observed live labels (non-exhaustive):

- Offerings without teaching assignment: **360 / 444**
- Delivery groups without V2 TA: **181 / 181**
- Cells missing delivery groups: **48 / 64**
- Overall readiness scores shown in UI bands (e.g. 55/100, 68/100, critical bands 48/100 / 49/100) — informational; cell matrix above is the apply gate.

---

## What this unlocks / still blocks

| Gate | Status |
|---|---|
| Preview runnable against production | PASS |
| Source row count settled | PASS — **131** |
| Any READY rows to commit | FAIL — **0** |
| Import confirm | **NOT DONE** (forbidden here) |
| Controlled data apply | Requires course catalog match, aliases/programs, DG generation after headcounts, then re-preview |

---

## Artifacts

- This report only (docs PR).
- Temp preview JSON used during the session was not committed.
- No application/code/migration changes.

---

## POST_PR103_REBASELINE

Mission: `PLATFORM-LAUNCH-STAGE-03C-PR103-MERGE-PUBLISH-REBASELINE-01`
Rebaseline time: `2026-07-28T04:00:20+03:00` (live deploy detect) · Preview replay after publish
PR #103 HEAD: `af41e3c94769e110a970a018196f6a65465108e9`
PR #103 merge commit / MAIN_SHA: `1e389c418540cdae3a4fb378ff9f9503f487e258`
Live deployment: `370d917b3ce93706948c8b90c0a4874b8a2dfca326139b6cfc5a62cc8e8b5cec`
Method: same as Stage 03B — Super Admin JWT + identical parser/resolver path; Preview only; no import confirm; no DB writes.

### BEFORE (pre-PR #103 — authoritative Stage 03B)

| Metric | Count |
|---|---:|
| TOTAL_SOURCE_ROWS | 131 |
| TOTAL_EXPANDED_ROWS | 265 |
| READY | 0 |
| BLOCKED | 24 |
| AMBIGUOUS | 53 |
| NOT_FOUND | 188 |
| CONFLICT | 0 |
| DUPLICATES | 0 |
| `course_not_found` | 186 |
| `ambiguous_component` | 36 |
| `delivery_groups` | 24 |
| `ambiguous_instructor` | 17 |
| `unknown_program` | 2 |

### AFTER (post-PR #103 publish)

| Metric | Count | Δ vs BEFORE |
|---|---:|---:|
| SEM1_SOURCE_ROWS | 66 | 0 |
| SEM2_SOURCE_ROWS | 65 | 0 |
| TOTAL_SOURCE_ROWS | **131** | 0 |
| TOTAL_EXPANDED_ROWS | **247** | −18 |
| READY | **0** | 0 |
| BLOCKED | **20** | −4 |
| AMBIGUOUS | **69** | +16 |
| NOT_FOUND | **158** | −30 |
| CONFLICT | **0** | 0 |
| DUPLICATES | **0** | 0 |
| `course_not_found` | **156** | −30 |
| `ambiguous_component` | **34** | −2 |
| `delivery_groups` | **20** | −4 |
| `ambiguous_instructor` | **35** | +18 |
| `unknown_program` | **2** | 0 |

**Interpretation:** Count drops are **not** treated as import success. READY remains **0**. Matching stays fail-closed and scoped to program×level×term×system. The rise in `ambiguous_instructor` is expected after removing bare-name preference (ambiguity must not become READY). Remaining blockers are official-data / operational dependencies, not unresolved source-matching defects.

### CLOSED_SOURCE_MATCHING_ISSUES

- Arabic digit / punctuation normalization gaps that previously blocked scoped code/name matching.
- Unscoped global course-code matching (now plan×level×semester scoped).
- Instructor bare-name preference that could collapse ambiguity incorrectly.
- Regression coverage via anonymized Stage 03C fixture + harness cases on main (PR #103).

### REMAINING_OFFICIAL_DATA_BLOCKERS

- Catalog / plan gaps driving `course_not_found` (156) — still the dominant class (`CATALOG_DATA_MISSING`, wrong level/term/program, approved aliases only).
- Duplicate / hours-mismatched plan components (`ambiguous_component` 34).
- Duplicate instructor display names requiring official disambiguation (`ambiguous_instructor` 35; **4** distinct names after PR103 — عيسى محمد، مبارك السفياني، حمود الشلبي، محمد مكرد).
- Unmapped program labels (`unknown_program` 2: `علوم`, `الموازي`) needing official clarification — no guessed aliases.

### REMAINING_OPERATIONAL_DEPENDENCIES

- Approved headcounts for active cohorts (readiness still blocked).
- Room types on plan components where required for DG generation.
- Generate delivery groups after HC + room-type readiness (`delivery_groups` 20 remaining; none READY after dependencies alone).
- No import confirm until READY > 0 under official package.

### REQUIRED_USER_SOURCES

1. Official course catalog / active-plan corrections for missing and wrong-level/term/program titles (no agent-invented aliases).
2. Official component dedupe / hours decisions for ambiguous plan components.
3. Official instructor identity resolution for duplicate names.
4. Official mapping or rejection for program labels `علوم` and `الموازي`.
5. Approved headcount sheet (or equivalent) for active cohorts.
6. Confirmed room-type assignments where DG generation requires them.

### NEXT_ATOMIC_DATA_PACKAGE

`OFFICIAL_DATA_PACKAGE_01` — delivered as Stage 03D docs package (PR #104):  
`docs/PLATFORM-LAUNCH/STAGE-03D-OFFICIAL-DATA-SOURCE-PACKAGE.md` + fill templates under `docs/PLATFORM-LAUNCH/STAGE-03D-TEMPLATES/`.  
265-row ledger reconciled (247 live + 18 `SKIPPED` PR103 expansion delta). **No production writes.** User must return signed fills before any apply wave.

### 265 vs 247 reconciliation (Stage 03D)

| Bucket | Count |
|---|---:|
| Post-PR103 live expanded | 247 |
| `SKIPPED` / `PR103_EXPANSION_FANOUT_REMOVED` | 18 |
| **TOTAL_EXPANDED_RECONCILED** | **265** |
| UNACCOUNTED_ROWS | **0** |
