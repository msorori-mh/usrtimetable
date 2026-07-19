# End-to-End Admin Workflow Map

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`
**Roles:** SA = super_admin · CA = college_admin · RO = read_only

---

## Step 1 — University / college / department / program

| | |
| --- | --- |
| Inputs | Names, codes, university linkage |
| Outputs | Tenant tree ready |
| Screens | `/universities`, `/colleges`, `/departments`, `/programs` |
| Permission | SA for uni/colleges; CA for dept/program |
| Preconditions | Auth |
| Next | Create terms |
| Errors | Missing department on program (blocked); duplicate codes |
| Duplicate path? | Catalog Excel implies import — **false path** |
| Gap? | No guided wizard |
| Next-step clarity | **Weak** |

## Step 2 — Academic year / term

| | |
| --- | --- |
| Inputs | academic_year, term_type, dates, code |
| Outputs | Active `academic_terms` |
| Screens | `/terms` or import `academic_terms` |
| Permission | CA |
| Next | Courses / plans |
| Duplicate | UI + import (OK) |
| Gap | No first-class years entity (OK as column) |

## Step 3 — Courses

| | |
| --- | --- |
| Inputs | Course master data |
| Outputs | `courses` |
| Screens | `/courses` or via plan import |
| Next | Study plan |
| Gap | Hours may be re-entered on plan |

## Step 4 — Study plan + components

| | |
| --- | --- |
| Inputs | Program, levels, plan courses, component hours, electives |
| Outputs | Active plan + components + elective slots |
| Screens | `/study-plans`, import `full_study_plan` / `study_plan_courses`, electives import |
| Permission | CA |
| Preconditions | Program + levels |
| Next | Cohorts |
| Errors | Multiple active plans (runtime harden source-only) |
| Gap | Component editing UX less obvious than Excel |

## Step 5 — Create cohort

| | |
| --- | --- |
| Inputs | program, level, term, study_system, expected_students |
| Outputs | `academic_cohorts` |
| Screens | `/academic-cohorts`, import |
| Next | Elective approvals |
| Duplicate | UI + import |
| Gap | After create, next CTA not always forced |

## Step 6 — Approve elective selections

| | |
| --- | --- |
| Inputs | cohort + slot → selected course |
| Outputs | `cohort_elective_selections` |
| Screens | Import primary; weak dedicated UI |
| Permission | CA |
| Next | Generate curriculum |
| **Gap** | **HIGH — no clear approval screen** |
| Error | Curriculum skips unselected electives (shown in summary) |

## Step 7 — Generate cohort curriculum (offerings)

| | |
| --- | --- |
| Inputs | Active plan + approved electives + cohort |
| Outputs | Generated `course_offerings` |
| Screens | Cohorts button «توليد منهج الدفعة» |
| RPC | `generate_cohort_curriculum` |
| Permission | CA |
| Preconditions | Plan active; electives decided |
| Next | Generate delivery groups |
| Duplicate | Must not use Legacy offerings import |
| Clarity | Summary card helps; nav still shows Legacy sections nearby |

## Step 8 — Generate delivery groups

| | |
| --- | --- |
| Inputs | Curriculum + components + capacity rules |
| Outputs | `delivery_groups` |
| Screens | Cohorts confirm dialog; list also on `/delivery-groups` |
| RPC | `generate_cohort_delivery_groups` |
| Next | Teaching assignments |
| Error | validation_errors / obsolete groups |
| Gap | Capacity policy UX thin |

## Step 9 — Assign instructors

| | |
| --- | --- |
| Inputs | DG + instructor + hours |
| Outputs | V2 `teaching_assignments` |
| Screens | `/teaching-assignments`, import V2 |
| RPCs | create/update/deactivate + workload preview |
| Preconditions | DGs exist; policies ideally configured |
| **Gap** | Workload policies UI missing |
| Next | Constraints / availability |

## Step 10 — Constraints and availability

| | |
| --- | --- |
| Inputs | Hard unavailability, Soft prefs, room blocks, structural constraints, templates, breaks |
| Outputs | Rule tables |
| Screens | `/availability`, `/constraint-settings`, `/time-slot-templates`, `/daily-breaks`, `/scheduling-settings` |
| Gap | Hard/Soft mixed; competing time_slots page |
| Next | Create draft version |

## Step 11 — Create Draft schedule version

| | |
| --- | --- |
| Inputs | term, name |
| Outputs | `schedule_versions` draft |
| Screens | `/schedule-versions` |
| Next | Build |
| Gap | Eligibility/readiness not always blocking create |

## Step 12 — Build schedule

| | |
| --- | --- |
| Inputs | Assignments as work items |
| Outputs | `schedule_sessions` |
| Screens | `/schedule-builder` (primary); auto-schedule assist; legacy timetable hidden |
| RPCs | create/move session V2 |
| Permission | CA + version editable |
| Duplicate | auto vs builder vs legacy |
| Next | Conflicts |

## Step 13 — Resolve conflicts

| | |
| --- | --- |
| Inputs | Sessions |
| Outputs | conflict_results; optional approved exceptions |
| Screens | `/conflict-checks`, reports/conflicts |
| Next | Quality / review |

## Step 14 — Review schedule

| | |
| --- | --- |
| Inputs | Draft sessions + conflicts + quality |
| Outputs | Review decision |
| Screens | builder, quality, reports |
| Gap | No single «review checklist» screen |

## Step 15 — Approve

| | |
| --- | --- |
| Inputs | Clean hard conflicts / exceptions |
| Outputs | Lifecycle status advance |
| Screens | version transitions (lifecycle RPC — source-only apply gated) |
| **Gap** | Approval UX fragmented; migration may be unapplied remotely |

## Step 16 — Publish

| | |
| --- | --- |
| Inputs | Approved version |
| Outputs | published status; `/published-schedules` |
| Permission | CA/SA; locked after publish |
| Risk | Requires user-approved migration/runtime proof |
| Next | Reports |

## Step 17 — Reports

| | |
| --- | --- |
| Inputs | Published or draft version scope |
| Outputs | Instructor/room/cohort/workload/conflicts views |
| Screens | `/reports/*` |
| Gap | Section/department Legacy reports mislead |
| Rule | Reports must not recreate domain logic |

---

## Cross-cutting workflow findings

| ID | Finding | Severity |
| --- | --- | --- |
| WF-01 | No single guided pilot journey after login | HIGH |
| WF-02 | Elective approval step under-served in UI | HIGH |
| WF-03 | Generate curriculum/DG exist but sit beside Legacy sections | BLOCKER (IA) |
| WF-04 | Next-action messaging inconsistent except cohort summaries | MEDIUM |
| WF-05 | Publish/approve depends on unproven remote migrations | BLOCKER (runtime) |
| WF-06 | Import order documented in registry but not mirrored as wizard | MEDIUM |
| WF-07 | User can CRUD sections and derail New Flow | BLOCKER |
| WF-08 | Workload policies not manageable → assignment confidence low | BLOCKER |

## Happy-path (target, Pilot)

```
SA: University → Colleges
CA: Departments → Programs → Terms
CA: Import/UI Study Plan → Cohorts → Elective approvals
CA: Generate Curriculum → Generate Delivery Groups
CA: Teaching Assignments (+ Workload policies)
CA: Templates/Breaks/Hard unavailability/Constraints
CA: Draft Version → Schedule Builder (± Auto)
CA: Conflicts → Quality → Approve → Publish
All: Reports
```
