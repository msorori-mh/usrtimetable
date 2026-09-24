# Phase A1 — Legacy Usage Inventory

**Baseline:** `a8e5c0256134d8b41aae1d3dcc8f65d534680db6`

## Reproducible counts

Case-insensitive inventory of `course_offering_sections|section_groups|section_number|section_id|\bsections\b`, excluding dependency/build output:

- **798 matching lines in 124 files**: `src` 39, migrations 32, tests 23, docs 17, implementation reports 9, scripts 4.
- **9 user-facing route files with textual references; 7 operational dependencies.** The two non-operational files are `/import` (explicitly hidden Legacy text) and `/import-history` (historical label).
- **8 logical Legacy write paths**; 9 if `approveCapacitySplitProposal` is counted separately from Builder compatibility writes.
- **5 direct report surfaces** depend on sections.

These are source-reference counts, not production row counts or independent database relationships.

## Runtime inventory

| Surface | Evidence | Mode | Classification | Decision |
| --- | --- | --- | --- | --- |
| `/sections` | `src/routes/_authenticated/sections.tsx::SectionsPage/save/deleteMutation`; nav `src/components/app-layout.tsx:136` | READ/WRITE, user-facing | Legacy; creates/updates/deletes sections | `REMOVE_FROM_NAV`, `HIDE_FROM_NEW_FLOW`, `BLOCK_NEW_WRITES`, `RETAIN_FOR_HISTORY` |
| `/schedule-builder` | `schedule-builder.tsx`; `src/lib/schedule-builder/{queries,workspace,session-hydrate}.ts` | READ/filter, user-facing | Mixed; hydrates/filters `section_id` | `REPLACE_WITH_DELIVERY_GROUP`; Legacy metadata read-only |
| `/timetable/$versionId` | `src/components/timetable/session-dialog.tsx::save` | READ/WRITE | Mixed; saves `section_id` | `BLOCK_NEW_WRITES`, `REPLACE_WITH_DELIVERY_GROUP` |
| Section timetable | `reports.section-timetable.tsx`; `session-queries.ts::fetchSectionTimetableSessions` | READ/filter | Legacy report | `HIDE_FROM_NEW_FLOW`, retain historical read-only |
| Program timetable | `reports.program-level-timetable.tsx:53-87` | READ/filter | New label with Legacy section selector | `REPLACE_WITH_COHORT`/DG read model |
| Published timetable | `reports.published-timetable.tsx:43-115` | READ/filter | Mixed historical | `KEEP_READ_ONLY`, then replace projection with cohort/DG |
| Department schedule | `reports.department-schedule.tsx:34-68` | READ | Legacy | `HIDE_FROM_NEW_FLOW`, `REMOVE_POST_LAUNCH` |
| Conflicts | `operational-queries.ts::fetchConflictReportRows` | READ | V2 IDs plus Legacy evidence | Keep diagnostic Legacy evidence read-only |
| Import catalog | `/import` hides Legacy, but `/data-templates` renders the full catalog (`data-templates.tsx:46-71`) | Download/user-facing | Legacy templates remain discoverable | Hide from primary catalog; archive only |

## Legacy write paths

1. Section insert — `sections.tsx::save`.
2. Section update — `sections.tsx::save`.
3. Section delete — `sections.tsx` delete mutation.
4. Atomic section import insert/update — `_import_apply_sections` in `20260718210000_source_only_atomic_import_job_commit.sql`.
5. Atomic section-group/member import — `_import_apply_section_groups` in the same migration.
6. Legacy TA import resolves `section_number` and writes `teaching_assignments.section_id` — `_import_apply_teaching_assignments` in the same migration.
7. Timetable editor saves `schedule_sessions.section_id` — `session-dialog.tsx::save`.
8. Greedy scheduler and version clone propagate `section_id` — `src/lib/auto-scheduler/greedy.ts::runGreedyAutoSchedule`; `src/lib/schedule-versions/lifecycle.ts::cloneVersion`.

Additional compatibility mutation surface: `src/lib/schedule-builder/split-approval.ts::approveCapacitySplitProposal` passes `p_section_id`.

## Internal dependencies

- Conflict validation uses section/subgroup overlap (`src/lib/conflict-engine/validator.ts:293-312,532`; `scorer.ts:255`).
- Subgroup scheduling assumes shared `section_id` (`subgroup-auto-scheduler.ts:137-158,378-379`; `section-subgroups.ts:146-149`).
- `course_offering_sections` product runtime is mostly generated types and the delete guard (`src/lib/course-offerings/offering-delete-guard.ts:32`); historical migrations remain immutable.

## Required isolation rule

Keep all historical rows and migrations. Remove Legacy from New Flow navigation and catalogs, deny new Legacy writes at DB/RPC level, and replace operational identity with `academic_cohort` and `delivery_group`. Sections must not be used as a temporary shared-delivery model.
