# STAGE-03D — Official Data Source Package

Mission: `PLATFORM-LAUNCH-STAGE-03D-OFFICIAL-DATA-SOURCE-PACKAGE-01`
Generated: 2026-07-28 (Asia/Riyadh)
Scope: **read / analyze / document / template only — no production writes**
MAIN_SHA: `1e389c418540cdae3a4fb378ff9f9503f487e258`
LIVE_DEPLOYMENT: `370d917b3ce93706948c8b90c0a4874b8a2dfca326139b6cfc5a62cc8e8b5cec`
Production: `emzytxqkxjjhsivqxdiu` · ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8`
Workbook: `C:\Users\Elite\Downloads\b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx`

**Hard bans honored:** no import confirm, no INSERT/UPDATE/DELETE, no migrations / history repair, no DG/curriculum generation, no headcount/room-type writes, no Publish, no schedule create/run.

---

## FINAL_DECISION

`STAGE_03D_OFFICIAL_SOURCE_PACKAGE_READY`

The official-source package (row ledger, file inventory, classifications, fill templates, dependency order, launch options, and apply runbook) is complete. Full ITCS launch remains blocked until the user supplies the missing signed sources listed below. No production apply was executed.

---

## G0 — Expanded-row reconciliation (265)

### Authoritative post-PR103 live Preview (current)

| Status | Count | Primary reasons |
|---|---:|---|
| READY | 0 | — |
| BLOCKED | 20 | `delivery_groups` = 20 |
| AMBIGUOUS | 69 | `ambiguous_component` 34 + `ambiguous_instructor` 35 |
| NOT_FOUND | 158 | `course_not_found` 156 + `unknown_program` 2 |
| CONFLICT | 0 | — |
| IGNORED | 0 | — |
| **Subtotal (live expanded)** | **247** | matches Preview |

### The 18 rows “missing” from the post-PR103 category sum vs pre-PR103 265

| Status | Count | Classification |
|---|---:|---|
| SKIPPED | **18** | `PR103_EXPANSION_FANOUT_REMOVED` |

**Explanation:** Pre-PR103 Preview emitted **265** expanded outcomes. After PR #103 scoped matching/normalization, the same workbook emits **247**. The **18** are not silent live rows without a status — they are expansion fan-out outcomes that are **no longer produced** (fewer component-expansion attempts under fail-closed scoping). They are ledgered as `SKIPPED` / `PR103_EXPANSION_FANOUT_REMOVED` so the Stage-03B/03C **265** total reconciles exactly.

| Metric | Value |
|---|---:|
| TOTAL_EXPANDED_RECONCILED | **265** |
| UNACCOUNTED_ROWS | **0** |
| Live AFTER expanded | 247 |
| SKIPPED (PR103 delta) | 18 |

Per-outcome machine extract (session): `docs/PLATFORM-LAUNCH/STAGE-03D-TEMPLATES/stage03d-summary.json` (status/reason aggregates). Full 265 ledger retained in session temp only (not committed — contains operational detail; templates carry affected rows).

---

## G1 — Official source discovery (read-only)

Searched: `C:\Users\Elite\Downloads`, `C:\Users\Elite\Documents`, `C:\Projects`, and repo `docs/PLATFORM-LAUNCH`.

### Accepted as official for this package

| Path | Modified | SHA256 | Evidence | Covers | Prod conflict |
|---|---|---|---|---|---|
| `Downloads\b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx` | 2026-07-27 | `FBC23368CA36AF452935AB086E239FFF5B61BAE668DD9BE5887B330143A35098` | Operator teaching-assignment source used for Stage 03B/03C/03D live Preview | Sem1+Sem2 2026 ITCS assignment sheets | READY=0; not imported |

### Candidates — **not** accepted as apply-ready official (year / blank / unsigned)

| Class | Count | Notes |
|---|---:|---|
| `students_*_prepared.xlsx` (2025_2026_second) | 18 | Headcount **candidates** only. Stage 03A: year-carry to **2026–2027** requires explicit operator policy. `HEADCOUNTS_READY_FOR_APPLY = 0`. |
| `template_faculty.xlsx` | 1 | Blank platform template — not an HR export. |
| Migration query CSV export | 1 | Ops artifact, not academic source. |
| Study-plan / catalog PDF/DOCX/XLSX for CYB/CS/CIS/IT | **0** | **Not found** locally. |
| Official room-type matrix | **0** | **Not found**. |
| Official filled instructor roster with unique emp# | **0** | **Not found**. |

### OFFICIAL_FILES_MISSING (required from user)

1. Signed 2026–2027 study plans / course catalog for **CYB / CS / CIS / IT** (codes, names, level, semester).
2. Official component matrix (type + weekly hours + **required room type**).
3. Official HR instructor list resolving duplicate names to **one employee_number**.
4. Authorized **2026–2027** cohort headcounts (or signed year-carry from 2025–2026 prepared files).
5. Official program-label decisions for **`علوم`** and **`الموازي`**.

---

## G2 — `course_not_found` (156)

Classified against live catalog + **active** plans only. No aliases invented.

| Classification | Count | Meaning |
|---|---:|---|
| `CATALOG_ROW_MISSING` | **94** | No exact catalog/plan evidence |
| `COURSE_NOT_IN_ACTIVE_PLAN` | **34** | Catalog (or name) exists but not on active plan cell |
| `WRONG_LEVEL` | **12** | Exact name in same program, different level |
| `WRONG_TERM` | **6** | Exact name same program+level, different semester |
| `WRONG_PROGRAM` | **0** | — |
| `OFFICIAL_CLARIFICATION_REQUIRED` | **10** | Near-name / orthography candidates only — need signed alias |
| `COURSE_ALIAS_CONFIRMED` | **0** | None confirmed without user sign-off |

| Metric | Value |
|---|---:|
| COURSES_READY_FOR_DATA_FIX | **52** (`WRONG_LEVEL` + `WRONG_TERM` + `COURSE_NOT_IN_ACTIVE_PLAN`) — **planned** fix list only |
| COURSES_REQUIRING_CLARIFICATION | **104** (`CATALOG_ROW_MISSING` + `OFFICIAL_CLARIFICATION_REQUIRED`) |

Template (affected rows only): `STAGE-03D-TEMPLATES/missing_course_catalog.xlsx`
Fill columns: official code/name/program/level/semester + alias yes/no. **Empty fill fields — no assumed data.**

---

## G3 — Instructors & components

### `ambiguous_instructor` (35 expanded)

No source employee numbers. Matching used **exact normalized full-name keys only** (no partial-name linking).

| Source name | Rows | Candidate emp# | Class |
|---|---:|---|---|
| د. عيسى محمد | 7 | INST-030, EMP024, EMP015 | `DUPLICATE_NAME` |
| د. مبارك السفياني | 10 | INST-035, EMP031, EMP017 | `DUPLICATE_NAME` |
| د.حمود الشلبي | 9 | INST-022, EMP016 | `DUPLICATE_NAME` |
| د.محمد مكرد | 9 | EMP036, INST-040, EMP018 | `DUPLICATE_NAME` |

| Metric | Value |
|---|---:|
| INSTRUCTORS_RESOLVED | **0** |
| INSTRUCTORS_REQUIRING_CLARIFICATION | **35** rows / **4** distinct names |

Template: `STAGE-03D-TEMPLATES/instructor_identity_resolution.xlsx`

### `ambiguous_component` (34)

| Detail | Count | Required action (planned, not executed) |
|---|---:|---|
| `PLAN_COMPONENT_DUPLICATE` | 28 | Deduplicate plan components **or** official choose theory vs practical |
| `HOURS_MISMATCH` | 6 | Adjust source hours **or** add/correct component hours |

| Metric | Value |
|---|---:|
| COMPONENTS_READY_FOR_FIX | **34** |
| COMPONENTS_REQUIRING_CLARIFICATION | **0** (actions are data fixes / official choice, all actionable once signed) |

Template: `STAGE-03D-TEMPLATES/course_component_room_types.xlsx` (also lists DG-blocked rows needing room types).

---

## G4 — Operational dependencies (live read)

| Dependency | Current | Gate |
|---|---|---|
| Approved scheduling headcounts | **5 / 64** cells (59 missing) | Blocks DG + readiness |
| Timetabled components missing `required_room_type_id` | **233 / 307** | Blocks DG/schedule |
| Active cohorts missing delivery groups | **48 / 64** | Only CYB cells have groups today |
| Preview `delivery_groups` blockers | **20** | Course+component matched; DG absent |
| Instructor availability rows | **0** (known college-wide gap) | Later schedule quality |
| Overlapping time templates | not re-audited this mission; prior inventory stands | Later |

### Hard dependency order (do not skip)

```
catalog/plan
→ components + room types
→ official headcounts (2026–2027 authorized)
→ cohort curriculum refresh (only if plan changed)
→ delivery group generate
→ Preview
→ V2 import (only if READY matches are correct & scoped)
```

| Metric | Value |
|---|---:|
| HEADCOUNTS_WITH_SOURCE | **0** authorized |
| HEADCOUNTS_WITHOUT_SOURCE | **59** |
| ROOM_TYPES_READY_FOR_FIX | **233** (list ready for official fill; not auto-written) |
| DELIVERY_GROUPS_AFTER_DEPENDENCIES | **0** (still need generate after HC + room types) |

---

## G5 — User source package & templates

Created under `docs/PLATFORM-LAUNCH/STAGE-03D-TEMPLATES/`:

| File | Purpose |
|---|---|
| `missing_course_catalog.xlsx` | 156 course_not_found rows + fill columns |
| `instructor_identity_resolution.xlsx` | 4 duplicate-name groups |
| `program_label_clarifications.xlsx` | `علوم` / `الموازي` |
| `course_component_room_types.xlsx` | 34 ambiguous components + DG room-type needs |
| `cohort_headcounts.xlsx` | 59 cells missing approved HC + candidate file hints |
| `stage03d-summary.json` | Machine aggregates |

**Short list still missing locally:** signed catalog/plans, room-type matrix, HR emp# resolution, 2026–2027 HC authorization, program-label decisions.

---

## G6 — Launch scope matrix (options only — user chooses)

64 active cohort cells inventoried. **0** cells have Preview READY. **5** CYB Sem1 cells have approved HC **and** delivery groups, but Preview for those cells is still non-READY (catalog/instructor/component blockers).

### Option A — Full ITCS launch

Requires completing **all** missing official sources in G1/G5, then dependency chain G4, then Preview READY > 0, then separate import approval.

**FULL_LAUNCH_BLOCKERS:** catalog/plan gaps (156), instructor duplicates (35), component duplicates/hours (34), room types (233), headcounts (59), DG generate (48 cells), program labels (2), then re-Preview.

### Option B — Reduced first scope

Candidate **only after** official mini-package for that slice:

- Prefer cells that already have approved HC + DGs (**5 CYB Sem1**), **plus** signed course/instructor/component fixes for those rows only.
- Or: one program × one term with complete official catalog + HC + room types.

**Not chosen by this agent.** Both options remain user decisions.

---

## G7 — Atomic apply runbook (**DO NOT EXECUTE**)

1. **Preflight:** MAIN_SHA + LIVE deploy fingerprints; RLS/role = Super Admin; backup counts for courses, plan_courses, components, instructors, headcounts, DGs, TA V2; confirm templates signed.
2. **Exact write set (future):** only rows marked READY_FOR_DATA_FIX with signed fills — catalog/plan links, component dedupe/hours, room types, instructor deactivate/merge, headcount approve, then DG generate RPC.
3. **Expected before/after:** document counts per table; Preview READY must rise only for scoped correct matches.
4. **Atomicity:** prefer single RPC / transaction per domain wave; never mixed catalog+import.
5. **Post-verification:** re-read counts; re-Preview; assert no ambiguity→READY.
6. **Rollback:** restore from preflight export; revoke approvals; do not leave half-applied DG.
7. **Re-Preview:** mandatory after each wave.
8. **Import ban:** **forbid** V2 confirm if any READY row is unscoped, aliased without signature, or instructor matched by partial name.

---

## G8 — Git / PR

- This report + templates on branch `cursor/platform-stage-03d-official-data-source-package-01`.
- PR #102 remains Draft; POST_PR103_REBASELINE updated with pointer to this package. **Not merged.**

---

## Security Review

| Item | Value |
|---|---|
| Files changed | docs + templates only |
| Migrations changed? | no |
| RLS / RPCs changed? | no |
| Authentication impact | no |
| Authorization impact | no |
| Sensitive data exposure | templates use operational academic labels already in Preview; no secrets |
| Privilege escalation risk | no |
| Production risk | **none** (no writes) |
| Ready for merge (docs PR) | yes after CI |
| Ready for deploy | N/A (docs only) |

---

## Metric board (requested)

| ID | Value |
|---|---|
| TOTAL_EXPANDED_RECONCILED | 265 |
| UNACCOUNTED_ROWS | 0 |
| OFFICIAL_FILES_FOUND | 1 accepted (+18 HC candidates rejected for year policy) |
| OFFICIAL_FILES_MISSING | 5 categories |
| COURSES_READY_FOR_DATA_FIX | 52 |
| COURSES_REQUIRING_CLARIFICATION | 104 |
| INSTRUCTORS_RESOLVED | 0 |
| INSTRUCTORS_REQUIRING_CLARIFICATION | 35 |
| COMPONENTS_READY_FOR_FIX | 34 |
| COMPONENTS_REQUIRING_CLARIFICATION | 0 |
| HEADCOUNTS_WITH_SOURCE | 0 |
| HEADCOUNTS_WITHOUT_SOURCE | 59 |
| ROOM_TYPES_READY_FOR_FIX | 233 |
| DELIVERY_GROUPS_AFTER_DEPENDENCIES | 0 |
| TEMPLATES_CREATED | 5 |
| DATABASE_WRITES | none |
| MIGRATIONS_APPLIED | none |
