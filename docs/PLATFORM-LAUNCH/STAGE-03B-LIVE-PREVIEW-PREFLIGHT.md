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
