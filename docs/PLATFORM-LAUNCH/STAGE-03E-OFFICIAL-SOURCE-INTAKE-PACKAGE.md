# STAGE-03E — Official Source Intake Package

Mission: `PLATFORM-LAUNCH-STAGE-03E-OFFICIAL-SOURCE-INTAKE-PACKAGE-01`
Generated: 2026-07-28 (Asia/Riyadh)
Scope: **intake packaging only — no production writes**
Baseline: Stage 03D (`STAGE-03D-OFFICIAL-DATA-SOURCE-PACKAGE.md` / PR #104)
MAIN_SHA: `1e389c418540cdae3a4fb378ff9f9503f487e258`
LIVE_DEPLOYMENT: `370d917b3ce93706948c8b90c0a4874b8a2dfca326139b6cfc5a62cc8e8b5cec`

**Hard bans honored:** no import confirm, no INSERT/UPDATE/DELETE, no migrations, no DG/curriculum generation, no Publish, no schedule. **Filled Excel templates and real student data were not committed to GitHub.**

---

## FINAL_DECISION

`STAGE_03E_INTAKE_PACKAGE_READY_FOR_OFFICIAL_COMPLETION`

The empty intake package is assembled locally for official completion. Empty `_FILL` rows remain blocked until signed.

---

## Package locations (local only)

| Item | Path |
|---|---|
| Folder | `C:\Users\Elite\Downloads\ITCS-OFFICIAL-DATA-INTAKE` |
| ZIP | `C:\Users\Elite\Downloads\ITCS-OFFICIAL-DATA-INTAKE.zip` |
| README | `00_README_AR.md` |
| Manifest | `OFFICIAL-SOURCE-MANIFEST.csv` |

---

## File inventory & verification

| File | Affected rows | Verified |
|---|---:|---|
| `01_missing_course_catalog.xlsx` | **104** | = COURSES_REQUIRING_CLARIFICATION |
| `02_instructor_identity_resolution.xlsx` | **35** | = INSTRUCTORS_REQUIRING_CLARIFICATION |
| `03_cohort_headcounts.xlsx` | **59** | = HEADCOUNTS_WITHOUT_SOURCE |
| `04_course_component_room_types.xlsx` | **34 + 233 = 267** | components + unique missing room types; `record_id` dups = 0 |
| `05_program_label_clarifications.xlsx` | **2** | = PROGRAM_CLARIFICATION_REQUIRED |

### Column contract (each affected workbook)

- `record_id`
- `program` / `level` / `term` / `study_system` (context; blank study_system only on pure room-type catalog rows)
- `current_value`
- `available_options`
- `required_fill_field`
- `official_source_FILL`
- `notes_FILL`
- `approval_FILL`
- plus domain-specific empty `_FILL` columns (no defaults / no guesses)

### Integrity

| Check | Result |
|---|---|
| MISSING_CASES | **0** |
| DUPLICATE_CASES (`record_id` in file 04) | **0** |
| Manifest status | `EMPTY_AWAITING_OFFICIAL_FILL` |
| SHA256 before fill | recorded in `OFFICIAL-SOURCE-MANIFEST.csv` |

---

## Who fills / approves (summary)

See `00_README_AR.md` in the ZIP. Approvers also listed in the manifest:

1. Courses → academic committee / study-plan owner
2. Instructors → faculty affairs / academic HR
3. Headcounts → student affairs / cohort coordinator
4. Components + room types → academic committee + rooms owner
5. Program labels → college dean / academic committee

Empty rows stay blocked from Preview READY and import confirm.

---

## Git policy for this PR

- **Included:** this documentation file only.
- **Excluded from GitHub:** intake `.xlsx`, ZIP, filled returns, student extracts.
- PR #102 / #104 unchanged regarding merge (not merged here).

---

## Security Review

| Item | Value |
|---|---|
| Files changed (repo) | docs report only |
| Migrations / RLS / RPCs | no |
| Authn / Authz impact | no |
| Production writes | none |
| Secrets | none |
| Ready for merge (docs) | yes after CI |
| Ready for deploy | N/A |

---

## Metric board

| ID | Value |
|---|---|
| PACKAGE_FOLDER | `C:\Users\Elite\Downloads\ITCS-OFFICIAL-DATA-INTAKE` |
| ZIP_PATH | `C:\Users\Elite\Downloads\ITCS-OFFICIAL-DATA-INTAKE.zip` |
| COURSE_ROWS | 104 |
| INSTRUCTOR_ROWS | 35 |
| HEADCOUNT_ROWS | 59 |
| ROOM_TYPE_ROWS | 233 |
| COMPONENT_ROWS | 34 |
| PROGRAM_LABEL_ROWS | 2 |
| MANIFEST_RESULT | PASS |
| README_RESULT | PASS |
| MISSING_CASES | 0 |
| DUPLICATE_CASES | 0 |
| DATABASE_WRITES | none |
| MIGRATIONS_APPLIED | none |
