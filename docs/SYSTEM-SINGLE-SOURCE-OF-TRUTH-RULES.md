# System Single-Source-of-Truth Rules

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`
**Delta refresh:** `1af8787e676f6040b824dc3e177b3aacbcfdaec2`
**Status:** Binding for remediation design (not yet enforced by nav/UX cleanup)

## Core identity rules

1. **One program ↔ one department.**
   `academic_programs.department_id` is mandatory. No orphan programs. No college-level program without department.

2. **Cohort is the academic student source.**
   `academic_cohorts` defines who is taught for a program/level/term/`study_system`.
   Do not use `sections` as student context in Pilot.

3. **Study plan is the course membership source.**
   Approved `study_plans` + `plan_courses` define core courses for the cohort.
   No free individual core registration in timetable operations.

4. **Plan course component is the hours/type source.**
   `plan_course_components` owns weekly contact hours, component type, timetabled flag, and workload counting.
   Catalog `courses` hours are descriptive only when components exist.

5. **Delivery group is the execution-split source.**
   `delivery_groups` split a component for capacity/delivery only.
   They are not academic cohorts and not Legacy sections.

6. **Teaching assignment is the instructor/hours duty source.**
   V2 `teaching_assignments` bind instructor ↔ delivery group (+ component hours).
   Legacy assignment shapes are compatibility-only.

7. **Schedule session is the time/room source.**
   `schedule_sessions` record when/where a duty is placed inside a `schedule_version`.
   Sessions are created from assignments in Schedule Builder (or controlled auto-assist), not by inventing free-floating lectures.

## Time and rules

8. **Operating calendar source.**
   Days/hours bounds: `scheduling_settings`.
   Breaks: `daily_breaks`.
   Slot grid: `time_slot_templates` (study_system-scoped).
   `time_slots` must not compete as Pilot SoT.

9. **Hard unavailability source.**
   Instructor hard windows: `instructor_availability` with `is_preference = false` (and unavailable type).
   Room hard blocks: `room_unavailability`.
   Hard rules deny placement.

10. **Soft preference source.**
    Preference-flagged availability only. Soft rules score/warn; they do not silently become Hard.

11. **Constraint settings source structural rules only.**
    `college_constraint_settings` / `constraint_types` configure engine weights and structural policies.
    They must not store ad-hoc unavailability or substitute for Soft preferences.

12. **Conflicts are outcomes, not master data.**
    `conflict_results` are detected. Approved exceptions are explicit overrides.
    Operators must not re-enter the same rule in constraints + availability + conflicts.

## Generation and imports

13. **Imports must not create generated entities.**
    Forbidden Pilot imports: delivery_groups, cohort_curriculum/offerings V2, schedule_versions, schedule_sessions, published schedules, conflict/quality results.

14. **Generated chain is one-way.**
    Plan → Cohort → Elective selections → Curriculum (offerings) → Delivery groups → Teaching assignments → Sessions.

15. **Every mutation has one approved path.**
    Prefer RPC / atomic import commit / guarded client write with RLS.
    No browser-only authorization. No dual commit authorities for the same entity without classification.

## Isolation

16. **College isolation is absolute.**
    No cross-college reads/writes for operational data. Composite tenant integrity is required.

17. **Study systems `regular` and `parallel` are isolated.**
    Cohorts, offerings, DGs, sessions, templates, reports, and conflicts must not mix systems.

## Reports and UI

18. **Reports do not recreate domain logic.**
    They project SoT tables/RPCs. Workload reports consume policies + assignments; they do not define new load rules.

19. **UI labels must match SoT names.**
    دفعة = cohort · مجموعة تدريس = delivery_group · شعبة/قسم Legacy = hidden.
    Presence of a page is not proof of operational need.

20. **Legacy compatibility is quarantined.**
    `sections`, `course_offering_sections`, `section_groups*`, Legacy imports remain out of primary IA until removed after migration.

## Terminology and shared-delivery invariants

21. **Catalog sharing is not teaching sharing.**
    `course_programs` and `course_departments` are catalog association/eligibility links. They do not merge cohorts,
    offerings, delivery groups, assignments, sessions, capacity, conflicts, or reports.

22. **A delivery group has one cohort authority.**
    Every generated `delivery_group` belongs to exactly one `academic_cohort` and one plan-course component.
    The label “shared course” must never be used to infer a cross-cohort delivery group.

23. **Cross-cohort shared delivery fails closed.**
    The current model has no authoritative shared-delivery aggregate. A future design requires explicit participant
    cohorts, college and `study_system` isolation, capacity allocation, assignment/session identity, conflict rules,
    authorization, and audit. Until separately approved and implemented, cross-cohort delivery is prohibited.
