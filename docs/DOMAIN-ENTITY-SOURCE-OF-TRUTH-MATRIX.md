# Domain Entity Source-of-Truth Matrix

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`
**Sources:** `src/integrations/supabase/types.ts`, migrations, services, RPCs, routes, import registry

## Schema inventory

| Kind | Count |
| --- | ---: |
| Public tables (types) | 61 (+ migration staging artifacts) |
| Views | 1 (`v_instructor_delivery_workload`) |
| Roles enum | `super_admin` \| `college_admin` \| `read_only` |
| Academic years table | **None** — year is `academic_terms.academic_year` |

## Mandatory academic model (binding for this audit)

1. College contains departments
2. Every program **must** belong to a department (`department_id NOT NULL`)
3. Study plan defines courses for all cohort students
4. No free individual core registration
5. `academic_cohort` = cohort SoT
6. No sections in new flows
7. `delivery_group` = execution split of a plan-course component only
8. `sections` / `course_offering_sections` = Legacy only
9. `course_offerings` generated from cohort curriculum
10. `delivery_groups` generated from cohort components
11. `teaching_assignments` bind instructor ↔ delivery group
12. `schedule_sessions` created from assignment in Schedule Builder
13. `regular` / `parallel` isolated
14. No cross-college access

---

## Entity matrix

| Entity | Definition | Purpose | SoT | Created by | Input mode | Lifecycle | Key relations | Unique key | College | study_system | UI | Overlap | Legacy/Current | Necessary? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| university | Root org | Branding / multi-college root | `universities` | super_admin UI | Manual | Stable | → colleges | code | n/a | n/a | `/universities` | — | Current | Yes |
| colleges | Tenant boundary | Isolation unit | `colleges` | super_admin UI | Manual | Stable | → all domain | code | self | n/a | `/colleges` | Catalog download | Current | Yes |
| departments | Org unit under college | Owns programs/instructors/courses | `departments` | college admin UI | Manual | Stable | college → programs | college+code | yes | column present | `/departments` | Catalog | Current | Yes |
| academic_programs | Degree program | Academic track | `academic_programs` | UI | Manual | Stable | **must** department | college+code | yes | via dept/cohort | `/programs` | Catalog | Current | Yes |
| academic_levels | Levels per program | Plan/cohort positioning | `academic_levels` | UI / plan import | Manual+import | Stable | program | program+number | yes | n/a | via plans/import | Catalog UI-only | Current | Yes |
| academic_years | *(no table)* | Year label | `academic_terms.academic_year` | with terms | Manual/import | — | terms | — | yes | n/a | `/terms` | Conceptual only | Current | As column |
| academic_terms | Term instances | Scheduling period | `academic_terms` | UI + import | UI_AND_BULK | Active flag | → cohorts, versions, offerings | code | yes | n/a | `/terms` | — | Current | Yes |
| courses | Catalog course | Reusable course identity | `courses` | UI (+ plan import) | UI_AND_BULK via plan | Stable | dept; hours on course **and** plan | college+code | yes | n/a | `/courses` | Hours duplication with plan_courses | Current | Yes |
| study_plans | Approved curriculum shell | Defines cohort curriculum | `study_plans` | UI + full_study_plan import | UI_AND_BULK | active version | program → plan_courses | college+code/version | yes | n/a | `/study-plans` | Dual import templates | Current | Yes |
| plan_courses (study_plan_courses) | Course-in-plan | Cohort course membership | `plan_courses` | plan UI/import | Bulk/UI | with plan | course, level, semester | plan+course+level/sem | yes | n/a | study-plans / import | — | Current | Yes |
| plan_course_components | Theory/lab/… | Hours type + timetabling | `plan_course_components` | plan import/derive | Generated from plan | with plan_course | → delivery_groups, TA | plan_course+type | yes | n/a | import-driven | Course hours fields | Current | **Yes — hours SoT** |
| elective_slots | Elective windows | Cohort elective structure | `elective_slots` | plan import | Import | with plan | → slot courses, selections | plan+slot_code | yes | n/a | import | — | Current | Yes |
| elective_slot_courses | Candidates | Pool for slot | `elective_slot_courses` | import | IMPORT | with slot | course | slot+course | yes | n/a | import | — | Current | Yes |
| academic_cohorts | Cohort (دفعة) | Student academic context | `academic_cohorts` | UI + import | UI_AND_BULK | active | program, level, term, study_system | composite natural key | yes | **required** | `/academic-cohorts` | vs sections naming | **Current SoT** | **Yes** |
| cohort_elective_selections | Approved electives | Cohort-level elective decision | `cohort_elective_selections` | import (+ limited UI) | IMPORT primary | decided | cohort+slot → course | cohort+slot | yes | via cohort | weak UI | — | Current | Yes |
| course_offerings | Term offering row | Compatibility + session anchor | `course_offerings` | **generate_cohort_curriculum** (V2); Legacy import | SYSTEM_GENERATED / LEGACY import | status | term, course, plan_course, study_system | generated key | yes | yes | hidden `/course-offerings` | Dual meaning | Dual | Yes (generated) |
| sections | Legacy section | Old student grouping | `sections` | UI + Legacy import | LEGACY | — | term+course | section_number | yes | yes | `/sections` visible | **Collides with cohort/DG** | **Legacy** | Compatibility only |
| course_offering_sections | Legacy join | Offering↔section | `course_offering_sections` | Legacy | LEGACY | — | offering, section | pair | yes | — | none dedicated | — | Legacy | Compatibility |
| section_groups / members / subgroups | Legacy capacity splits | Old delivery splits | section_* | Legacy import | LEGACY | — | sections | — | yes | — | none / import legacy | vs delivery_groups | Legacy | Compatibility |
| delivery_groups | Teaching groups | Component capacity splits | `delivery_groups` | **generate_cohort_delivery_groups** | SYSTEM_GENERATED | active/obsolete | cohort, plan_course, component | group_code | yes | via cohort | `/delivery-groups` + cohorts | vs sections label | **Current** | **Yes** |
| instructors | Lecturer master | People resource | `instructors` | UI + import | UI_AND_BULK | active | dept, type | employee_number | yes | n/a | `/instructors` | — | Current | Yes |
| faculty_workload_policies | Rank load rules | Standard workload | `faculty_workload_policies` | **intended UI — missing page** | UI_ONLY (broken) | active | college | rank_code | yes | n/a | **NONE** | vs instructor max hours | Current | Yes — **UI gap** |
| teaching_assignments | Instructor↔DG (V2) | Teaching duty SoT | `teaching_assignments` | UI RPC + import V2; Legacy fields | UI_AND_BULK / Legacy | active/inactive | delivery_group, instructor, component hours | V2 natural key | yes | via cohort | `/teaching-assignments` | V1 Legacy rows coexist | Dual | **Yes V2** |
| rooms | Space master | Room resource | `rooms` | UI + import | UI_AND_BULK | active | type, building | code | yes | n/a | `/rooms` | — | Current | Yes |
| time_slots | Manual slot rows | Alternate grid | `time_slots` | UI | UI_ONLY | active | college | day+time | yes | n/a | `/time-slots` | **vs templates** | Ambiguous | Questionable |
| time_slot_templates | Template grid | Conflict/auto/builder slots | `time_slot_templates` | UI (+ catalog download) | UI_ONLY | — | study_system scoped | day+time+system | yes | **yes** | `/time-slot-templates` | vs time_slots, scheduling_settings | **Current SoT for grid** | Yes |
| daily_breaks | Break windows | Hard schedule holes | `daily_breaks` | UI + import | UI_AND_BULK | — | days[] | name | yes | n/a | `/daily-breaks` | — | Current | Yes |
| instructor_availability | Avail / unavail / preference | Hard+Soft mixed | `instructor_availability` | UI | UI_ONLY | — | instructor; `is_preference` | window | yes | n/a | `/availability` | Soft vs Hard same table | Current | Yes — needs UX split |
| room_availability | Soft/window room avail | Room windows | `room_availability` | UI | UI_ONLY | — | room | window | yes | n/a | `/availability` | — | Current | Yes |
| room_unavailability | Hard room blocks | Hard deny | `room_unavailability` | UI (+ catalog) | UI | — | room | window | yes | n/a | `/availability` | Catalog template | Current | Yes |
| scheduling_settings | Operating hours/days | Capacity baseline | `scheduling_settings` | UI | UI_ONLY | — | college | one/college | yes | n/a | `/scheduling-settings` | vs calendar/templates | Current | Yes |
| academic_calendar | Calendar events | Academic dates | `academic_calendar` | UI | UI_ONLY | — | college | — | yes | n/a | `/academic-calendar` | vs scheduling_settings | Current | Partial |
| constraint_types + college_constraint_settings | Structural rules | Engine weights | those tables | UI | UI_ONLY | — | college settings | type | yes | n/a | `/constraint-settings` | Must not store Soft prefs | Current | Yes |
| schedule_versions | Draft/published versions | Schedule container | `schedule_versions` | UI | SYSTEM lifecycle | draft→…→published | term | name/term | yes | filter | `/schedule-versions` | — | Current | Yes |
| schedule_sessions | Placed sessions | Time+room SoT | `schedule_sessions` | Builder from TA V2 | SYSTEM_GENERATED | with version | assignment, DG, room, time | session id | yes | yes | builder / legacy timetable | Dual columns Legacy | Current | Yes |
| schedule_quality_runs | Quality evidence | Scoring runs | `schedule_quality_runs` | quality UI/RPC | Generated | with version | version | run id | yes | — | `/schedule-quality` | — | Current | Yes |
| conflict_checks / conflict_results | Detected conflicts | Hard/warn evidence | those tables | conflict UI | Generated | with version | sessions | — | yes | isolated | `/conflict-checks` | ≠ constraints storage | Current | Yes |
| schedule_version_conflict_exceptions | Approved exceptions | Allow specific conflicts | exceptions table | conflict UX | Manual approve | status | version+pair | — | yes | — | via conflicts | — | Current | Yes |
| import_jobs / import_errors | Import runs | Bulk pipeline | those tables | `/import` | System | status | college, entity | job id | yes | — | `/import-history` | — | Current | Yes |
| import_templates / columns | DB template editor | Alternate template store | those tables | `/import-templates` | UI | — | college | — | yes | — | overlaps data-templates | Ambiguous | Questionable |
| profiles / user_roles / user_colleges | Identity | AuthZ | those + auth.users | `/users` | Manual | — | colleges | — | membership | n/a | `/users` | — | Current | Yes |
| audit_logs | Mutation trail | Compliance | `audit_logs` | writers | System | append | college | — | yes | — | **no viewer** | — | Current | Yes |
| auto_schedule_runs | Auto-scheduler runs | Automation log | `auto_schedule_runs` | `/auto-schedule` | System | — | version | — | yes | — | auto-schedule | vs builder | Current | Optional |
| Lookups (instructor_types, room_types, buildings, session_types, quality_*) | Reference data | Classification | respective tables | Lookup pages | UI_ONLY | — | college/global | code | mostly college | n/a | lookup routes | — | Current | Yes (subset) |
| course_programs / course_departments | Sharing links | Shared courses | those tables | `/shared-courses` + import | UI/import | — | course↔program | pair | yes | — | shared-courses | — | Current | Yes |
| reports | Read models | Views only | lib/reports | n/a | Derived | — | versions | — | yes | filtered | `/reports/*` | Must not recreate domain | Current | Yes |

---

## Model deviation register (entity vs mandatory model)

| ID | Deviation | Severity |
| --- | --- | --- |
| DEV-01 | `/sections` still CRUD-visible as «المجموعات الدراسية» | BLOCKER (IA) |
| DEV-02 | `course_offerings` dual: generated V2 + Legacy import template retained | HIGH |
| DEV-03 | `teaching_assignments` dual V1/V2 columns in one table | HIGH |
| DEV-04 | `schedule_sessions` retain Legacy section_* columns | MEDIUM (debt) |
| DEV-05 | `time_slots` vs `time_slot_templates` competing grids | HIGH |
| DEV-06 | Hard/Soft preferences share `instructor_availability` without clear IA | HIGH |
| DEV-07 | `faculty_workload_policies` no admin UI | BLOCKER |
| DEV-08 | Catalog offers UI-only foundational templates (colleges/depts/programs) implying import | MEDIUM |
| DEV-09 | Schema allows cohort study_system beyond Pilot (`evening`/`distance`/`other`) | MEDIUM |
| DEV-10 | Program↔department enforced in DB/UI — **compliant** | OK |

---

## Generation chain (authoritative)

```
study_plans (+ components, electives)
  → academic_cohorts
  → cohort_elective_selections (approved)
  → generate_cohort_curriculum → course_offerings (V2)
  → generate_cohort_delivery_groups → delivery_groups
  → teaching_assignments (V2)
  → schedule_versions + schedule_sessions (builder)
  → conflict_results / quality_runs / publish
```
