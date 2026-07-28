# PLATFORM-LAUNCH-STAGE-03C-SOURCE-MATCHING-AUDIT-01

## Scope and evidence

Source-only audit from `origin/main` at `7ec63a2a93a7ec001c2522ff1802f0222775d1b9`.
No production write, migration apply, Lovable Publish, live academic-data mutation, or
Cursor-report edit was performed.

The live read-only evidence was reconciled against:

- `docs/PLATFORM-LAUNCH/CURSOR-PRODUCTION-READONLY-INVENTORY-01.md`.
- Cursor Stage 03C evidence commit `41925f01ef76b9d0c05177e6201ea7e0275751b1`
  (`STAGE-03C-LIVE-BLOCKER-RECONCILIATION.md`), read without modifying it.
- The current parser/resolver implementation and an anonymized structural fixture.

## LOCAL_PREVIEW_REPRODUCTION

`tests/fixtures/teaching-assignments-source/stage-03c-live-preview-anonymized.ts`
records the exact non-sensitive distribution and representative formatting patterns:

| Metric | Reproduced |
|---|---:|
| source rows | 131 |
| expanded rows | 265 |
| READY | 0 |
| `course_not_found` | 186 |
| `ambiguous_component` | 36 |
| `ambiguous_instructor` | 17 |
| `unknown_program` | 2 |
| missing delivery groups | 24 |

The five non-READY categories sum to 265. The fixture contains no instructor identity,
employee number, or live course record. Resolver regressions use synthetic catalog rows
to exercise the same code/name/program/level/term/component/instructor branches.

## MATCHING_AUDIT

| Area | Finding | Classification | Evidence / decision |
|---|---|---|---|
| Course code | Formatting variants (`CS 101`, `CS-١٠١`, full-width Latin, Persian digits) were not canonicalized. Code matching also searched the whole college catalog before enforcing active plan + program + level + semester. | **SOURCE BUG** | Fixed with exact canonical code keys and scoped candidate sets. No fuzzy or substring match was added. |
| Arabic course name | Arabic letter variants were normalized, but punctuation and internal whitespace could cause false `NOT_FOUND`. | **SOURCE BUG** | Fixed with a dedicated exact canonical name key that removes formatting punctuation/spacing after Arabic normalization. Multiple canonical hits remain ambiguous. |
| Arabic/English digits | Arabic/Persian digits failed in course codes, academic levels, and hours. | **SOURCE BUG** | General decimal-digit normalization now covers course codes, level parsing, and hours parsing. |
| Carry-forward | Instructor/course/level/program continuation is sheet-local and already correct on current main. | **CLOSED SOURCE BUG** | Regression remains in the anonymized merged-cell fixture; carry-forward never crosses sheets. |
| Program/level/term scope | Name matching was scoped; code matching was not. | **SOURCE BUG** | Both code and name candidates now require the active plan, program, level, and sheet-derived semester. |
| Component selection | 30 outcomes have equal-hour duplicate plan components; 6 have source hours inconsistent with a single component or component sum. | **CATALOG DATA / OFFICIAL AMBIGUITY** | No resolver guess. Exact single component and exact all-component sum remain the only READY paths. |
| Instructor disambiguation | 17 rows map two source names to duplicate employee records. The resolver previously preferred one “bare-name” row after stripping titles. | **OFFICIAL AMBIGUITY + SOURCE SAFETY BUG** | Removed formatting-based preference. One canonical candidate is READY; multiple IDs are always `AMBIGUOUS` and require employee-code/HR reconciliation. |
| Program aliases | `علوم` is incomplete; `الموازي` is a study-system token, not a program. | **OFFICIAL AMBIGUITY** | No alias added. Both remain `unknown_program`; no row-specific rule or guess. |
| Delivery groups | 24 outcomes have matched course/component but lack cohort×component groups; their headcount and room-type prerequisites are also missing. | **CATALOG / OPERATIONAL DATA** | No source fix. Generate only in a separately authorized write window after official prerequisites. |

## LIVE_CATEGORY_CLASSIFICATION

### `course_not_found` — 186

- `RESOLVER_BUG` in the recorded live outcomes: **0**. The read-only cross-check found no
  same-cell exact normalized catalog hit that the old resolver missed.
- `COURSE_NAME_ALIAS_REQUIRED`: **10** — aliases require an official course crosswalk.
- `COURSE_NOT_IN_ACTIVE_PLAN`: **36**.
- `WRONG_PROGRAM`: **2**.
- `WRONG_LEVEL`: **16**.
- `WRONG_TERM`: **6**.
- `CATALOG_DATA_MISSING`: **116**.

The canonicalization fixes prevent general false `NOT_FOUND` cases going forward, but this
report does not claim they convert any of the 186 live outcomes to READY. The live evidence
classifies those rows as official catalog/source reconciliation.

### `ambiguous_component` — 36

- Equal-hour plan component duplicates: **30**.
- Hours mismatch: **6**.
- Proven missing resolver rule: **0**.

Choosing theory versus practical from equal hours would be a guess. The resolver continues
to block these rows until the official component or hours are supplied.

### `ambiguous_instructor` — 17

All 17 are duplicate canonical names across multiple employee records. No partial-name
linking or title-based preference is allowed. HR must provide the canonical employee code
or reconcile duplicates.

### `unknown_program` — 2

Both require official clarification. `علوم` cannot safely choose CS/CIS/IT/CYB and
`الموازي` cannot be converted into a program alias.

### Missing delivery groups — 24

These are not matching defects. Approved headcounts, component room types, and generated
delivery groups are required before import can become READY.

## GENERAL_FIXES

- Added `normalizeDecimalDigits`, `canonicalCourseCodeKey`, and `courseNameMatchKey`.
- Scoped course-code candidates to the active plan/program/level/semester before resolving.
- Parsed Arabic/Persian digits in level and hours cells.
- Made canonical instructor duplicates fail as `AMBIGUOUS`; removed the bare-name
  formatting preference.
- Added no new row-specific alias.

## REGRESSION_TESTS

- Equivalent code forms: ASCII, spaced, hyphenated Arabic digits, Persian digits, and
  full-width Latin.
- Equivalent Arabic names with punctuation/hyphen/extra spaces.
- Course code duplicated outside the selected program/level/term does not cause false
  ambiguity or cross-scope matching.
- Arabic numeric level/hours parsing.
- Instructor punctuation normalization and true duplicate-ID ambiguity.
- Existing carry-forward, `expand_all`, component ambiguity, delivery-group blocker,
  regular/parallel expansion, and valid-row contracts.
- Exact 131/265/0 distribution accounting.

## FILES_CHANGED

- `src/lib/excel-import/arabic-normalize.ts`
- `src/lib/excel-import/teaching-assignments-source-parser.ts`
- `src/lib/excel-import/teaching-assignments-source-resolver.ts`
- `tests/fixtures/teaching-assignments-source/stage-03c-live-preview-anonymized.ts`
- `tests/harness/teaching-assignments-source-workbook-import.harness.ts`
- `docs/PLATFORM-LAUNCH/CODEX-STAGE-03C-SOURCE-MATCHING-AUDIT.md`

## PRODUCTION_ACTIONS_REQUIRED

- Official course catalog/plan reconciliation for the 186 course outcomes.
- Official component/hour selection for 36 component outcomes.
- HR employee-code reconciliation for 17 instructor outcomes.
- Official clarification of the two program labels.
- Approved headcounts, room types, and later delivery-group generation for 24 outcomes.
- A fresh read-only preview after those actions; import confirm remains separately
  authorized.

## FINAL_DECISION

`READY_FOR_DATA_RECONCILIATION`

All proven general source-matching defects found by this audit are fixed and covered by
regression tests. The current live zero-READY state is still explained by official
catalog/source ambiguity and operational dependencies, not by an unresolved source
matching blocker.
