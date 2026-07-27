# PLATFORM-LAUNCH-STAGE-02-PRODUCTION-READONLY-INVENTORY-01

Inventory time: 2026-07-28 (Asia/Riyadh)
Production project: `emzytxqkxjjhsivqxdiu`
Scope: authenticated read-only inventory. No production data write, write RPC, import, generation, migration, publish, or merge was performed.

## EXECUTIVE_SUMMARY

The ITCS structural foundation exists: four target programs, sixteen program-owned levels (1–4 for every program), four active plans with no competing active plan, two 2026–2027 terms, and exactly 64 active cohorts covering every `program × level × term × regular/parallel` combination. All program/department and cohort/program/level/term references observed through production reads are same-college and valid.

The launch data is not ready. The 64-cell readiness matrix has `0 READY`, `54 INVALID_DATA`, `5 MISSING_OFFICIAL_DATA`, and `5 MISSING_OPERATIONAL_SETUP`. Only five Sem1 CYB cohorts have approved headcounts; 59 do not. Delivery groups exist only for the 16 CYB cells (181 rows); the other 48 cells have none. Production has 174 teaching assignments, but every one carries a Legacy `section_id`, none carries a V2 `delivery_group_id`, and 37 rows exceed a duplicate composite key. Of 307 timetabled plan components, 233 have no `required_room_type_id`; one CYB summer-training plan course has no timetabled component by design, while two timetabled CYB project components also lack a room type.

The real source workbook was parsed offline and resolved against the live read-only catalog with the correct sheet-to-term mapping and both study systems. Its 131 data rows use only levels 1–4, but preview remains `0 MATCHED`: 164 expanded outcomes are `course_not_found`, 19 `unknown_program`, 24 `ambiguous_component`, 17 `ambiguous_instructor`, and 22 are blocked by missing delivery groups. Therefore the former zero-valid-row result was not caused only by a wrong term/system selection.

Stage 02B closed the former `P0-MIG-HISTORY-READ` blocker via **Lovable Cloud → SQL editor** (project Time Table / production `emzytxqkxjjhsivqxdiu`): a SELECT-only read of `supabase_migrations.schema_migrations` returned **75 rows** with columns `version`, `name`, `statements`, `created_by`, `idempotency_key`, `rollback` (no `inserted_at`/`checksum` columns in this schema). PostgREST still cannot expose that schema; absence from PostgREST is not evidence of absence. Catalog probes (`to_regclass` / `pg_proc` / `pg_trigger`) were also run read-only through the same SQL editor. No migration apply, history repair, or production write was performed.

## MAIN_AND_LIVE_STATE

| Item | Actual evidence | Result |
|---|---|---|
| `origin/main` | `62245a3bf4f49091177d6248c3bc8e05ddbfb90d` | MATCH |
| Local baseline | branch created from `origin/main` at the same SHA; tracked tree clean before report | MATCH |
| PR #95 merge | merge commit `26fa512` is contained in main history | CLOSED |
| Live HTTP | `https://gomufadhala.com` returned 200 | PASS |
| Live deployment | response header `x-deployment-id: d8a28b82b1d73a02518dc2c5716a7f882b527a719e224a6356daa3e19fa801ac` | MATCH |
| Live flow fingerprint | live JavaScript contains New Flow delivery-group labels and `/data-readiness`; no `/sections` or `/course-offerings` navigation target was found | PASS for operational navigation |
| Production access | existing user `716f0f62-26ad-4db5-b2cf-7a2e6c4daefa`, role `super_admin`; PostgREST `GET` only | PASS |
| Anonymous negative read | target tables returned either zero visible rows or 401 for anon | RLS/grant boundary observed |

Completed CI/build/smoke tests were not rerun because this task discovered no application-code gap and changed documentation only.

## PROGRAM_MATRIX

College: `7168345f-cf9d-4789-b2ad-547abb687dc8` · `ITCS` · كلية تكنولوجيا المعلومات وعلوم الحاسوب.

| Program | ID | Department | Same college | Levels | Active plans | Plan courses | Timetabled components | Missing component room type |
|---|---|---|---:|---|---:|---:|---:|---:|
| `cs` | `d8911731-6e7b-4ecf-a6b5-19b06a15039f` | `CS` / قسم علوم الحاسوب | yes | 1,2,3,4 | 1 | 46 | 77 | 77 |
| `it` | `f6f33a51-f62f-49ce-b5e8-275f6c0378b8` | `IT` / قسم تكنولوجيا المعلومات | yes | 1,2,3,4 | 1 | 46 | 79 | 79 |
| `cyb` | `52ecd9ff-3564-48fa-b9a8-3e1405d1e863` | `IT` / قسم تكنولوجيا المعلومات | yes | 1,2,3,4 | 1 | 45 | 76 | 2 |
| `cis` | `a1aa48db-c06e-4e49-aef4-8d7acf4cd0b6` | `CIS` / قسم نظم المعلومات الحاسوبية | yes | 1,2,3,4 | 1 | 46 | 75 | 75 |

The schema has no separate program `active` column. Existence, valid ownership, an active plan, and active cohorts are the available operational indicators; all four satisfy those indicators.

## ACADEMIC_LEVELS

Production contains 16 ITCS level rows: exactly levels 1–4 for each of `cs`, `it`, `cyb`, and `cis`. Every level has the target program and ITCS college. The source workbook uses only levels `{1,2,3,4}`; no parsed data row has a null, non-integer, below-1, or above-4 level.

## STUDY_PLANS

| Program | Active plan | ID | Version | Other plans | Conflict |
|---|---|---|---|---:|---|
| `cs` | `CS-2026-2027` | `c97a8bdb-d0e0-4f9c-9548-c33d93000922` | 1 | 0 | none |
| `it` | `IT-2026-2027` | `7e4cd689-c402-40a9-85aa-99d7752e7fad` | 1 | 0 | none |
| `cyb` | `CY-2026-2027` | `795b75f2-14db-473e-a6a7-860713daf1c3` | 1 | 0 | none |
| `cis` | `CIS-2026-2027` | `97cdf82d-eb3d-43af-80b4-37ae8ac94838` | 1 | 0 | none |

No program has two active plans.

## COURSES_AND_COMPONENTS

Production totals: 229 catalog courses, 183 plan courses, 308 components, 307 timetabled components.

| Program | Theory components / hours | Practical components / hours | Tutorial components / hours | Other | Excluded/non-timetabled |
|---|---:|---:|---:|---|---|
| `cs` | 43 / 90 | 25 / 58 | 9 / 22 | — | 0 |
| `it` | 43 / 88 | 29 / 66 | 7 / 18 | — | 0 |
| `cyb` | 42 / 88 | 28 / 64 | 4 / 8 | 2 project / 0h | 1 summer training / 6h |
| `cis` | 43 / 92 | 21 / 50 | 11 / 26 | — | 0 |

Scheduled theory hours total 358; scheduled practical/tutorial hours total 312. The database model excludes scheduling through `plan_course_components.is_timetabled=false`; there is no `plan_courses.excluded_from_scheduling` column. The CYB summer-training row is the sole non-timetabled component. The one CYB plan course with no timetabled component corresponds to that exclusion. Invalid data remains: 233 timetabled components have null `required_room_type_id`, including two CYB project components.

## TERMS

| Term | ID | Code | Type | Dates | Active |
|---|---|---|---|---|---:|
| الفصل الدراسي الأول 2026-2027 | `18dd364a-76d7-40b8-a217-fa929c082a7f` | `2026-T1` | first | 2026-09-06 → 2027-01-14 | yes |
| الفصل الدراسي الثاني 2026-2027 | `0e40bd71-1eb0-44c8-b0f7-0ca911264baf` | `Sem2` | second | 2027-02-01 → 2027-05-15 | yes |

## COHORTS

There are 64 active ITCS cohorts: four programs × four levels × two terms × two study systems. Every matrix cell has exactly one cohort. Regular and parallel are separate records. There are no duplicate cohort codes, no cross-college references, no level/program mismatch, and no cohort without a level or active plan. Sem2 has all 32 expected cohorts.

## HEADCOUNTS

Five approved rows exist, all in `2026-T1` CYB:

| Cohort slice | Registered | Scheduling | Status |
|---|---:|---:|---|
| CYB L1 regular | 120 | 100 | approved |
| CYB L2 regular | 95 | 80 | approved |
| CYB L3 regular | 80 | 60 | approved |
| CYB L1 parallel | 80 | 65 | approved |
| CYB L2 parallel | 55 | 50 | approved |

No override exists. Fifty-nine of 64 active cohort/term/system cells have no approved scheduling headcount; all 32 Sem2 cells are missing official headcounts.

## COHORT_CURRICULUM

`course_offerings` contains 444 ITCS rows, all active with program, level, and plan-course identity. Of these, 360 map to the target programs, two target terms, and regular/parallel systems. Every readiness cell has generated offerings: 22 or 23 per program/term/system context, with smaller 3–7 course subsets at a specific level/semester as shown in the readiness matrix. The remaining 84 rows are other study-system/context rows and are not counted as the target 64-cell curriculum.

## DELIVERY_GROUPS

There are 181 delivery groups, all attached to CYB cohorts. All 16 CYB matrix cells have groups; all 48 CS/IT/CIS cells have zero. No cross-college cohort/group reference was observed.

## INSTRUCTORS

There are 88 ITCS instructors; all are active and all have employee numbers. Forty-six have no `department_id`. Four active instructor types exist: permanent, from-other-college, external collaborator, and visiting.

## TEACHING_ASSIGNMENTS

Production has 174 ITCS assignments. Results:

- V2 assignments with `delivery_group_id`: 0.
- assignments with Legacy `section_id`: 174.
- orphan instructor: 0.
- cross-college assignment: 0.
- regular/parallel mismatch in mapped references: 0 observed.
- duplicate composite keys `(instructor, delivery group, component, offering)`: 32 keys, representing 37 excess rows.
- none maps to the new program/level/term/system readiness cells as a V2 delivery-group assignment.

This inventory did not upload or commit the Excel workbook.

## ROOMS_AND_ROOM_TYPES

ITCS has four active room types with positive defaults: lecture hall 60, cybersecurity lab 35, network lab 35, computer lab 30. It has 19 active rooms: 14 lecture halls (capacity 60) and five labs (capacity 30). No room has non-positive capacity and every room references an active type.

Operational mismatch: the named cybersecurity and network lab rooms are typed as generic `computer_lab`; therefore CYB cells requiring the dedicated cybersecurity/network types have no matching active room, even though those room-type catalog rows exist.

## TIME_TEMPLATES

There are 67 active templates. Working days are `{6,0,1,2,3,4}` (Saturday–Thursday). Regular windows cover 08:00–14:00 and parallel windows cover 14:00–20:00. The `both` templates provide 2h/3h candidate windows over 08:00–14:00. There are 139 overlapping same-day/same-system template pairs; these are shifted scheduling candidates rather than confirmed timetable sessions, but they violate a literal “non-overlapping templates” data rule and require an operator decision. `time_slots` and daily breaks are empty. Scheduling settings are 08:00–14:00, 60-minute base slots, allowed duration 1/2/3h, and Saturday–Thursday.

## AVAILABILITY

Instructor availability rows: 0. Instructor preference rows: 0. Instructor hard-unavailability rows: 0. Room availability rows: 1 (Q1, Sunday 08:00–14:00). Room unavailability rows: 0. Preferences and hard-unavailability are not mixed because neither exists. Only one of nine constraint types has an explicit college setting: hard instructor availability, enabled at weight 100.

## SCHEDULE_VERSIONS

Production has zero schedule versions and zero schedule sessions. Therefore there is no published experimental schedule, no duplicate official version, and no current `schedule_sessions.section_id`/`section_group_id` dependency. This is a clean absence, not schedule readiness.

## MIGRATION_HISTORY_SOURCE

| Field | Value |
|---|---|
| Tool | Lovable Cloud SQL editor (`More → Cloud → SQL editor`) |
| Auth | Lovable operator session (Tarasana) on project `c14ffafc-2bc4-44f0-aef6-c8785e7ca67b` |
| Target | production project `emzytxqkxjjhsivqxdiu` |
| Query surface | `supabase_migrations.schema_migrations` (SELECT only) |
| Columns present | `version` (text), `name` (text), `statements` (text[]), `created_by` (text), `idempotency_key` (text), `rollback` (text[]) |
| Columns absent | `inserted_at`, `executed_at`, `checksum` |
| Alternate history tables | none additional required; this is the live history table |
| Rejected channels | PostgREST (`schema_migrations` 404 / not exposed); Supabase Dashboard SQL (unauthenticated sign-in); Supabase CLI / Management API / `DATABASE_URL` / `service_role` (all absent) |

## MIGRATION_HISTORY_ROWS

- **Row count:** 75
- **Created_by:** almost all `apikey@lovable.dev`; three anomalous rows have null `created_by` / `name` / `statements`
- **Earliest version:** `20260604222654`
- **Latest version:** `20260724002013` with `name=20260724002012_99172989-d50c-4963-9470-1bc51ff3401e` (UUID twin / stamp skew: local file stamp `…012`, remote history version `…013`)
- **Anomalous empty history rows:** `20260715200200`, `20260715200500`, `20260715200600` (`PARTIAL` — history present, statements null)
- **Remote history without matching local filename (5):** `20260719005741`, `20260719015552`, `20260719025116`, `20260719034626`, `20260719034943` (UUID applied-copies; statements identify import lifecycle, source-only lifecycle/hardening payloads, and Schedule Builder V2 assignment foundation)

## RECONCILIATION_MATRIX

Repository files: **111**. Remote history rows: **75**. File↔history pairs after UUID / ±1–2s stamp matching: **70**. Local files with no history pair: **41**. Remote history with no local file: **5** (+ 3 anomalous empty rows still counted in the 75).

### Focus classifications

| Migration | History | Objects (catalog SELECT) | Classification |
|---|---|---|---|
| `20260724002012_99172989-…` (local) ↔ remote `20260724002013` | yes (UUID; name uses `…012`) | `scheduling_cohort_term_headcounts`, `scheduling_headcount_overrides`, `scheduling_headcount_revisions` + 6 headcount RPCs present | `MATCHED` |
| `20260721180000_source_only_scheduling_headcount_foundation` | no | superseded by matched applied-copy above; do not apply | `NOT_APPLIED` (intentionally superseded) |
| `20260720143000_source_only_program_department_integrity` | no | `ensure_prog_college()` + trigger `prog_check_college` present | `OBJECTS_PRESENT_HISTORY_MISSING` |
| `20260718210000_source_only_atomic_import_job_commit` | no local stamp; remote `20260719005741` statements are PR#45 atomic import | `commit_import_job_atomic(p_job_id uuid, p_expected_updated_at timestamptz)` present | `MATCHED` (content/history twin `20260719005741`) |
| `20260718120000_source_only_atomic_schedule_version_lifecycle` | no local stamp; remote `20260719015552` statements carry SOURCE-ONLY lifecycle header | `transition_schedule_version(...)` present | `PARTIAL` (history twin exists; treat as applied-with-source-only header, verify body before any re-apply) |
| `20260717050000_source_only_harden_cross_college_references` | no local stamp; remote `20260719025116` statements carry SOURCE-ONLY hardening header | college-aware relationships in live schema; exact constraint set not fully diffed | `PARTIAL` |
| `20260717043000` / `20260717093000` TA V2 / builder integration | no local stamps; remote `20260719034626` / `20260719034943` statements reference V2 assignment foundation | `delivery_groups`, `teaching_assignments`, import/finalize RPCs present; V2 assignment rows still 0 | `MATCHED` for foundation objects; operational data still empty |
| `20260716030000_generate_cohort_curriculum` | no | `generate_cohort_curriculum(p_cohort_id uuid)` present | `OBJECTS_PRESENT_HISTORY_MISSING` |
| `20260715120000_approve_capacity_split_proposal` | no | `approve_capacity_split_proposal(...)` present | `OBJECTS_PRESENT_HISTORY_MISSING` |
| `20260720120000_source_only_availability_all_active_days` | no | no instructor availability rows; helper presence not required for launch data | `NOT_APPLIED` |
| `20260721090000_source_only_legacy_write_hardening` | no | 174 Legacy assignments remain; hardening not certified applied | `NOT_APPLIED` |
| `20260718183000_forward_harden_cohort_curriculum_runtime` | no | generator exists; hardened body not history-pinned | `NOT_APPLIED` |
| 22× `20260715012xxx`/`…14100` `ss_*` conflict helper source files | no | `ss_%` proc count = **0** | `NOT_APPLIED` |
| Early UUID baseline files (Jun–Jul stamp ±1s twins) | yes via stamp/UUID | core public tables queryable | `MATCHED` |
| Remote empty stamps `20260715200200/500/600` | yes, statements null | no local file with those exact versions | `PARTIAL` |
| Remote Jul19 UUID rows without local files | yes | see focus rows above | `HISTORY_PRESENT_OBJECTS_MISSING` only if a future object probe fails; currently treated as applied-copy history for features present in catalog |

### Aggregate counts (local files)

| Class | Approx count | Notes |
|---|---:|---|
| `MATCHED` | 70+ content twins | includes stamp/UUID pairs and Jul19 applied-copy twins for import/V2 foundation |
| `OBJECTS_PRESENT_HISTORY_MISSING` | ≥3 | program/department integrity, capacity-split RPC, curriculum generator (and possibly more hardening) |
| `PARTIAL` | ≥5 | empty history stamps; source-only headers recorded in history; lifecycle/hardening twins |
| `NOT_APPLIED` | ≥25 | all `ss_*` helpers, original headcount source file, availability source-only, legacy hardening, curriculum forward-harden |
| `HISTORY_PRESENT_OBJECTS_MISSING` | 0 confirmed after catalog probes for focus features | Jul19 rows map to present functions/tables |
| `UNKNOWN` | **0** | history read channel is available |

## REQUIRED_REPAIRS

Read-only recommendations only (do **not** execute in this stage):

1. **History stamp documentation:** record that production headcount apply is version `20260724002013` / name `20260724002012_99172989-…` — not a missing object.
2. **History repair candidates (controlled later):** insert/align history for `OBJECTS_PRESENT_HISTORY_MISSING` rows (`20260720143000`, `20260716030000`, `20260715120000`) **or** accept them as out-of-band applies with audit notes — never re-apply blindly.
3. **Anomalous empty history rows** `20260715200200/500/600`: investigate origin; do not delete without backup.
4. **Do not apply** `20260721180000` (superseded) or any `ss_*` pack until conflict-runtime strategy is approved.
5. **Source-only files with remote Jul19 twins:** treat remote UUID versions as the applied identity; keep local `source_only_*` files as source of truth for diffs, not as re-apply candidates.

## REQUIRED_MIGRATIONS

None authorized for automatic apply. Controlled reconciliation may later need:

| Priority | Item | Reason |
|---|---|---|
| defer | `ss_*` conflict helper pack | `NOT_APPLIED`; zero `ss_%` procs |
| defer | `20260721090000` Legacy write hardening | Legacy assignments still exist; apply only after Legacy disposition |
| defer | `20260720120000` availability all-active-days | no availability data loaded yet |
| defer | `20260718183000` curriculum forward-harden | generator already present; harden only with body diff |
| never re-apply | `20260721180000` headcount original | objects already `MATCHED` via `20260724002013` |
| history-only repair | program/department integrity, capacity-split, curriculum generator | objects present; history gap only |

## SAFE_ORDER

1. Freeze: no `db push`, no Lovable migration approve, no history DELETE/UPDATE.
2. Export full `schema_migrations` CSV + object inventory (already started via Lovable SQL).
3. Diff each `OBJECTS_PRESENT_HISTORY_MISSING` source file against live `pg_get_functiondef` / trigger definitions.
4. Decide per file: history-repair-only vs forward migration vs accept-as-is.
5. Only after signed plan: apply deferred `NOT_APPLIED` files in dependency order (`ss_*` only if conflict runtime requires them; then availability; then Legacy hardening last).
6. Re-read history and re-run object probes; require zero unexpected `PARTIAL`.
7. Resume data reconciliation (headcounts → room types → DGs → TA V2) — separate write gates.

## ROLLBACK_REQUIREMENTS

- Keep Lovable/SQL CSV export of all 75 history rows as the pre-repair baseline.
- Any history INSERT/UPDATE must be reversible with the exported row image; never DELETE production history without dual approval.
- Any real DDL apply needs pre-snapshot of affected `pg_proc`/`pg_trigger`/`pg_policy` definitions and a compensating migration reviewed in advance.
- Headcount / import / schedule RPCs already live: rollback is restore-from-snapshot, not “re-run source_only”.
- No publish/replace of official schedules is in scope for migration reconciliation.

## RLS_AND_RPC_INVENTORY

Production behavior observed:

- authenticated `super_admin` can read all inventoried ITCS business tables.
- anon received zero rows for several RLS-filtered tables and 401 for `academic_cohorts`/`delivery_groups`.
- PostgREST schema/OpenAPI metadata returned 401 and required service-role access.

Source contracts for deployed feature families:

- curriculum, delivery-group, TA V2, and headcount functions are `SECURITY DEFINER`.
- curriculum/delivery/TA source uses fixed `SET search_path = public`; the headcount applied copy uses `SET search_path = public, pg_temp`.
- source migrations revoke PUBLIC/anon execute and grant authenticated/service_role for the public entrypoints.
- helper functions use narrower service-role-only grants where defined.
- table RLS uses college view/manage predicates; authenticated direct writes to headcount tables are revoked in the applied-copy source.

Actual `pg_proc.prosecdef`, `proconfig`, `proacl`, `pg_policy`, `relrowsecurity`, trigger, constraint validation, and remote migration-history rows remain unreadable from the approved application session. They are not claimed as remotely matched.

## READINESS_MATRIX

Columns: active plan, cohort, approved headcount, curriculum offerings, delivery groups, required room-type count, V2 teaching assignments, room coverage, time-template coverage, result. Availability is globally one room row and zero instructor rows; it is an operational gap for every cell.

| Program | L | Term | System | Plan | Cohort | HC | Curriculum | DG | Room types | TA V2 | Rooms | Time | Result |
|---|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| cs | 1 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 1 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 1 | Sem2 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 1 | Sem2 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 2 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 2 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 2 | Sem2 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 2 | Sem2 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 3 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 3 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 3 | Sem2 | regular | 1 | 1 | 0 | 7 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 3 | Sem2 | parallel | 1 | 1 | 0 | 7 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 4 | 2026-T1 | regular | 1 | 1 | 0 | 4 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 4 | 2026-T1 | parallel | 1 | 1 | 0 | 4 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 4 | Sem2 | regular | 1 | 1 | 0 | 4 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cs | 4 | Sem2 | parallel | 1 | 1 | 0 | 4 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 1 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 1 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 1 | Sem2 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 1 | Sem2 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 2 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 2 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 2 | Sem2 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 2 | Sem2 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 3 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 3 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 3 | Sem2 | regular | 1 | 1 | 0 | 7 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 3 | Sem2 | parallel | 1 | 1 | 0 | 7 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 4 | 2026-T1 | regular | 1 | 1 | 0 | 5 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 4 | 2026-T1 | parallel | 1 | 1 | 0 | 5 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 4 | Sem2 | regular | 1 | 1 | 0 | 3 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| it | 4 | Sem2 | parallel | 1 | 1 | 0 | 3 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cyb | 1 | 2026-T1 | regular | 1 | 1 | 1 | 6 | 22 | 2 | 0 | yes | yes | MISSING_OPERATIONAL_SETUP |
| cyb | 1 | 2026-T1 | parallel | 1 | 1 | 1 | 6 | 11 | 2 | 0 | yes | yes | MISSING_OPERATIONAL_SETUP |
| cyb | 1 | Sem2 | regular | 1 | 1 | 0 | 6 | 9 | 3 | 0 | no | yes | MISSING_OFFICIAL_DATA |
| cyb | 1 | Sem2 | parallel | 1 | 1 | 0 | 6 | 9 | 3 | 0 | no | yes | MISSING_OFFICIAL_DATA |
| cyb | 2 | 2026-T1 | regular | 1 | 1 | 1 | 6 | 21 | 3 | 0 | no | yes | MISSING_OPERATIONAL_SETUP |
| cyb | 2 | 2026-T1 | parallel | 1 | 1 | 1 | 6 | 12 | 3 | 0 | no | yes | MISSING_OPERATIONAL_SETUP |
| cyb | 2 | Sem2 | regular | 1 | 1 | 0 | 6 | 11 | 3 | 0 | no | yes | MISSING_OFFICIAL_DATA |
| cyb | 2 | Sem2 | parallel | 1 | 1 | 0 | 6 | 11 | 3 | 0 | no | yes | MISSING_OFFICIAL_DATA |
| cyb | 3 | 2026-T1 | regular | 1 | 1 | 1 | 5 | 11 | 4 | 0 | no | yes | MISSING_OPERATIONAL_SETUP |
| cyb | 3 | 2026-T1 | parallel | 1 | 1 | 0 | 5 | 8 | 4 | 0 | no | yes | MISSING_OFFICIAL_DATA |
| cyb | 3 | Sem2 | regular | 1 | 1 | 0 | 6 | 12 | 3 | 0 | no | yes | INVALID_DATA |
| cyb | 3 | Sem2 | parallel | 1 | 1 | 0 | 6 | 12 | 3 | 0 | no | yes | INVALID_DATA |
| cyb | 4 | 2026-T1 | regular | 1 | 1 | 0 | 5 | 9 | 3 | 0 | no | yes | INVALID_DATA |
| cyb | 4 | 2026-T1 | parallel | 1 | 1 | 0 | 5 | 9 | 3 | 0 | no | yes | INVALID_DATA |
| cyb | 4 | Sem2 | regular | 1 | 1 | 0 | 4 | 7 | 2 | 0 | no | yes | INVALID_DATA |
| cyb | 4 | Sem2 | parallel | 1 | 1 | 0 | 4 | 7 | 2 | 0 | no | yes | INVALID_DATA |
| cis | 1 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 1 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 1 | Sem2 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 1 | Sem2 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 2 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 2 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 2 | Sem2 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 2 | Sem2 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 3 | 2026-T1 | regular | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 3 | 2026-T1 | parallel | 1 | 1 | 0 | 6 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 3 | Sem2 | regular | 1 | 1 | 0 | 7 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 3 | Sem2 | parallel | 1 | 1 | 0 | 7 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 4 | 2026-T1 | regular | 1 | 1 | 0 | 5 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 4 | 2026-T1 | parallel | 1 | 1 | 0 | 5 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 4 | Sem2 | regular | 1 | 1 | 0 | 4 | 0 | 0 | 0 | yes | yes | INVALID_DATA |
| cis | 4 | Sem2 | parallel | 1 | 1 | 0 | 4 | 0 | 0 | 0 | yes | yes | INVALID_DATA |

`Rooms=yes` with zero required room types means the room catalog itself is healthy but plan-component room requirements are invalid/missing; that row remains `INVALID_DATA`.

## CONTRADICTIONS_RESOLVED

| # | REPORTED_CLAIM | ACTUAL_EVIDENCE | FINAL_VERDICT | REQUIRED_ACTION |
|---:|---|---|---|---|
| 1 | Four official plans may be absent | exactly four plans, one active per target program | CLOSED: present | retain one-active-plan invariant |
| 2 | CS/CIS/IT levels may be absent | all four levels exist for all four programs | CLOSED: present | no level creation |
| 3 | Sem2 cohorts may be absent | 32 Sem2 cohorts, one per program/level/system | CLOSED: present | add official headcounts; do not recreate cohorts |
| 4 | Zero Preview rows may be only wrong term/system | correct sheet mapping + both systems still gives 0 matched; course/instructor/component/DG blockers enumerated above | FALSE | reconcile catalog, aliases, components, groups, then rerun preview |
| 5 | Six campus/location labels are unmatchable | exactly six nonblank unknown labels remain: `كل الأقسام مع الجوف`, `نظم معلومات + الجوف`, `علوم حاسوب +نظم+ الجوف`, `امن سبراني`, `نظم الجوف + مارب`, `الموازي` | CONFIRMED | approve explicit alias/campus policy; never silently coerce |
| 6 | V2 importer is ready for real assignment | parser and resolver run, but live preview is 0 matched and production has zero V2 assignments | PARTIAL, not operationally ready | close catalog/DG/alias/instructor blockers before controlled import |
| 7 | Migration history is consistent | Lovable SQL read: remote version `20260724002013` with name `20260724002012_99172989-…`; headcount tables/RPCs present → `MATCHED` UUID twin | CLOSED: stamp skew explained | do not re-apply `20260721180000`; document twin in controlled reconciliation |
| 8 | Live uses New Flow only | New Flow navigation/readiness fingerprints are live; Legacy routes/tables and 174 Legacy assignments still exist | operational UI yes; database no | keep Legacy hidden and reconcile Legacy assignments before hardening |

## SINGLE ISSUE REGISTER

| Severity / ID | Evidence | Root cause | Impact | Final fix | Dependencies | Acceptance gate | Production write approval? |
|---|---|---|---|---|---|---|---|
| CLOSED `P0-MIG-HISTORY-READ` | Lovable Cloud SQL SELECT of `supabase_migrations.schema_migrations` (75 rows) + catalog probes | former PostgREST/CLI gap; Cloud SQL editor provides SELECT | history read unblocked; Stage 02B complete | proceed to controlled reconciliation plan (no apply yet) | operator Lovable Cloud access | every focus migration classified; `UNKNOWN=0` | no |
| P0 `P0-HEADCOUNT-59` | 5/64 approved | official counts loaded only for CYB Sem1 subset | fail-closed readiness | enter/approve official counts | migration history reconciliation; official source | 64/64 approved and source-attributed | yes |
| P0 `P0-TA-V2-ZERO` | 174 Legacy; 0 V2; 37 excess duplicates | assignments predate delivery-group runtime | scheduler has no New Flow assignments | controlled reconciliation/import after preview is clean | catalog, DG, aliases, headcounts | zero preview blockers; V2 assignment coverage complete; Legacy disposition approved | yes |
| P0 `P0-ROOMTYPE-233` | 233/307 timetabled components have null room type | three plans imported without component room-type resolution; two CYB projects unresolved | invalid scheduling requirements | assign canonical active room types; decide project rule | official plan owner | zero timetabled component missing room type | yes |
| P1 `P1-DG-48` | 48 matrix cells have zero groups | only CYB delivery groups generated | no V2 assignment target | generate groups only after approved headcounts and component validation | P0 headcounts/room types | every active cohort has expected groups, idempotency checked | yes |
| P1 `P1-ROOM-COVERAGE` | dedicated cyber/network types exist but no rooms use them | named labs typed generic computer lab | CYB cells lack required room coverage | reclassify approved labs or change official component requirement | facilities owner | every required active room type has adequate active rooms | yes |
| P1 `P1-WORKBOOK-PREVIEW` | 0 matched; 164 course-not-found, 19 unknown, 24 component ambiguous, 17 instructor ambiguous, 22 DG blocked | workbook naming and live catalog are not reconciled | import unsafe | approve aliases/course mapping and instructor identity fixes; regenerate preview only | plan/DG/TA fixes | preview produces intended valid rows and zero silent coercions | yes (catalog fixes); preview itself no |
| P1 `P1-INSTRUCTOR-DEPT-46` | 46/88 instructors lack department | incomplete resource master | RBAC/workload/report scoping degraded | assign verified departments | HR/college source | zero active internal instructor missing required department | yes |
| P2 `P2-TIME-TEMPLATE-OVERLAP` | 139 overlapping candidate pairs | shifted 2h/3h candidates coexist with coarse windows | ambiguous literal template rule | approve candidate-window semantics and deduplicate only true duplicates | scheduler owner | documented invariant; zero unintended duplicate template | yes if changed |
| P2 `P2-AVAILABILITY-SPARSE` | instructor 0, room availability 1, hard unavailability 0, preferences 0 | operational availability not entered | solver uses default/unrestricted behavior | load approved availability/preferences separately | staffing/facilities owners; migration semantics | explicit policy plus representative coverage; hard vs soft separated | yes |
| CLOSED `C-STRUCTURE` | 4 programs, 16 levels, 4 single active plans, 64 valid cohorts, no duplicate codes | — | structural base valid | preserve | — | regression checks | no |
| CLOSED `C-ROOM-BASE` | 19 rooms, positive capacity, active types | — | base room catalog valid | preserve | — | zero invalid room FK/capacity | no |
| CLOSED `C-SCHEDULE-EMPTY` | zero versions/sessions | — | no bad published state | preserve until controlled creation | reconciliation complete | first experimental version follows gates | later yes |
| CLOSED `C-LIVE-DEPLOYMENT` | deployment/header and New Flow navigation fingerprints match | — | correct release is live | preserve | — | deployment remains pinned | no |

Counts: P0=3 open (+1 closed history-read), P1=4, P2=2.

## REQUIRED_PRODUCTION_WRITES

Required eventually, but not performed: 59 official headcount approvals; room-type completion for 233 components; verified room reclassification; 46 instructor department links; delivery-group generation for 48 cells; controlled V2 assignment reconciliation/import; approved alias/course/instructor corrections; availability/preferences; and later an experimental schedule version. Each is a separate production-write approval gate.

## REQUIRED_MIGRATIONS

See Stage 02B section above. **No migration is authorized to apply in this PR.** Deferred candidates remain `ss_*` helpers, availability source-only, Legacy write hardening, and curriculum forward-harden — only after signed body diffs. Never re-apply `20260721180000`. History-gap repairs for objects already present are documentation/history-repair tasks, not DDL re-applies.

## SAFE_EXECUTION_ORDER

1. ~~Obtain catalog-capable read-only evidence~~ **DONE (Stage 02B / Lovable Cloud SQL).**
2. Produce controlled reconciliation plan from `REQUIRED_REPAIRS` / deferred `NOT_APPLIED` list (still no apply).
3. Approve the canonical program aliases and resolve workbook course/instructor identities without importing.
4. Correct official plan-component room types and room-type coverage.
5. Enter and approve official headcounts for all required cohort cells.
6. Generate missing delivery groups idempotently in a controlled write window.
7. Rerun read-only workbook preview; require zero unresolved/ambiguous/silent-coercion outcomes.
8. Reconcile Legacy assignments and perform the controlled V2 import with audit evidence.
9. Enter approved availability/preferences and validate hard/soft separation.
10. Recompute readiness; require the intended pilot cells to be READY.
11. Only then create an experimental schedule and run scheduling validation. Publishing remains a separate release-lead gate.

## ROLLBACK_REQUIREMENTS

- Retain the Stage 02B Lovable SQL export of all 75 `schema_migrations` rows as the migration baseline.
- Capture pre-write exports/counts/checksums for headcounts, components, rooms, cohorts, offerings, groups, assignments, and availability before any data write.
- Every write batch needs an immutable audit/job ID and deterministic source mapping.
- Group generation/import must prove transactionality and idempotent rerun behavior.
- Legacy assignment reconciliation requires an explicit mapping and compensating restore plan; do not delete first.
- Any future migration needs a catalog snapshot, version pin, maintenance window, reverse-order compensating migration, and post-apply ACL/RLS/function verification.
- Schedule work starts experimental only; no publish transition is part of reconciliation.

## FINAL_DECISION

`STAGE_02_COMPLETE_READY_FOR_CONTROLLED_RECONCILIATION`

Stage 02B obtained a trusted full read of production migration history (75 rows) via Lovable Cloud SQL, reconciled UUID/stamp twins (including `20260724002013` ↔ local `20260724002012_99172989-…`), and classified focus migrations without `UNKNOWN`. No production write, migration apply, or history repair was performed.
