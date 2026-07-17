# Academic Plan / Cohort Alignment Agent

Date: 2026-07-18 (Asia/Riyadh)

## Outcome

The new academic-delivery foundation is cohort-first: the approved study plan generates internal course offerings for a specific `academic_cohort`, approved cohort elective selections are validated, and `delivery_groups` split plan-course components. The current application still contains substantial section-based Schedule Builder, auto-scheduler, reporting, import-template, fixture, and generated-type surfaces. Those are classified as Legacy compatibility and were not removed.

No lifecycle, conflict/exception, central state/policy/log/decision file, migration, real data, or production system was changed.

## Transition map

| Legacy responsibility | Cohort-first authority | Transition rule |
| --- | --- | --- |
| `sections` identifies a student teaching population | `academic_cohorts` identifies the student academic context | New flows require `cohort_id`; a section may be read only through an explicitly authorized Legacy adapter. |
| `course_offering_sections` links offerings to populations | Approved study plan -> cohort curriculum; `delivery_groups` link a cohort to a plan-course component | Do not create COS rows in new generation. Keep existing rows readable for Legacy screens and reports. |
| `section_subgroups` expresses splits | `delivery_groups` expresses capacity/delivery-nature splits | New assignments and sessions use `delivery_group_id`; subgroup data remains Legacy-only. |
| `schedule_sessions.section_id` and `teaching_assignments.section_id` | `cohort_id` plus optional `delivery_group_id` | When both models exist, cohort/group is authoritative and section is round-trip compatibility metadata only. |
| Section study system | `academic_cohorts.study_system` and matching offering/session predicates | Reject cross-system context; `regular` and `parallel` must never share resolution paths. |
| Individual registration/enrollment ownership | Cohort plan plus approved cohort elective selection | Expected counts are planning metadata, not evidence of individual core-course registration. |

## Audit findings

### Aligned new flow

- `generate_cohort_curriculum` derives required courses from the selected plan, cohort level, term semester, and study system; validates elective-slot membership; creates no sections, COS, subgroups, delivery groups, or sessions.
- The import UI hides direct sections, Legacy teaching assignments, and manual course-offering import from new operational choices.
- The course-offerings screen is read-only, describing offerings as an internal generated layer.
- Delivery-group generation is cohort-scoped, explicit, confirmed, and does not auto-run after import.
- Teaching-assignment V2 and delivery-group database guards compare cohort/term/program/level/study-system context.

### Legacy-only section dependence retained

- `src/lib/auto-scheduler/greedy.ts` reads and writes `section_id`.
- Schedule Builder local models, editor harnesses, enrollment/subgroup logic, and older UAT fixtures use sections.
- Section timetable routes and section administration remain reachable for compatibility.
- Generated Supabase types expose historical section tables and nullable section columns.
- Historical/source-only remediation migrations manipulate sections and COS; they were not edited or applied.

These paths need deliberate caller-by-caller migration. Bulk removal would break compatibility and is outside this safe source-only scope.

## Implemented safe fix

Added `legacy-section-adapter.ts`, a pure compatibility boundary that:

- requires `academic_cohort` when a delivery group is supplied;
- makes cohort/group authoritative when a legacy section is also present;
- rejects a section-only path unless the caller explicitly opts into Legacy fallback;
- rejects `regular`/`parallel` study-system mismatch;
- performs no database writes or migration.

A focused harness covers the cohort-first, explicit Legacy fallback, orphan delivery-group, unauthorized section, and study-system isolation cases.

## Ownership and follow-up

No overlapping owned file was modified, so no `OWNERSHIP_CONFLICT` was recorded.

Recommended follow-up is to route individual Legacy boundaries (auto-scheduler, builder persistence, section reports) through the compatibility adapter as their owners migrate them. Each conversion should first establish a complete cohort/delivery-group read model and retain the section round-trip only where a documented compatibility consumer remains.

## Verification

- Focused Bun harness: `PASS`.
- `git diff --check`: `PASS`.
- TypeScript: `PASS` after the leader reused the verified baseline dependency tree.
- Production build: `PASS`.
- Scoped ESLint: `PASS`.
- `git diff --check`: `PASS`.

The leader may commit, push, and open a Draft PR with independent review still required. Production status remains unchanged.
