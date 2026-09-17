# Import vs UI vs Generated — Decision Matrix

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`
**Sources:** `registry.ts`, `templates.ts`, `catalog.ts`, validators/commit path, admin routes

## Path codes

| Code | Meaning |
| --- | --- |
| UI_ONLY | Manage only in UI |
| IMPORT_ONLY | Bulk Excel is primary |
| UI_AND_BULK_IMPORT | Both legitimate |
| SYSTEM_GENERATED | Never imported |
| LEGACY_ONLY | Compatibility only |
| NOT_NEEDED | Remove from operator surface |

## Entity decisions

| Entity | Path | Rationale | UI | Import | Notes |
| --- | --- | --- | --- | --- | --- |
| universities / colleges | UI_ONLY | Rare, interactive | Yes | No | Catalog download → hide or doc-only |
| departments / academic_programs | UI_AND_BULK_IMPORT | Foundational and may be bulk-loaded | Yes | ACTIVE | Same college-scoped unified importer |
| levels | UI_ONLY | Covered by plan setup | Yes | No | Catalog UI_MANAGED |
| academic_terms | UI_AND_BULK_IMPORT | Few UI; bulk OK for multi-college | Yes | ACTIVE | Keep |
| courses | UI_AND_BULK_IMPORT (via plan) | Prefer plan import for founding | Yes | via full_study_plan | Standalone courses catalog download: demote |
| study_plans + plan_courses + components + elective_slots | UI_AND_BULK_IMPORT | Large founding datasets | Partial UI | full_study_plan / study_plan_courses | Merge guidance |
| course_programs | UI_AND_BULK_IMPORT | Shared courses | `/shared-courses` | ACTIVE | Keep |
| instructors / rooms / daily_breaks | UI_AND_BULK_IMPORT | Volume + external HR/facilities | Yes | ACTIVE | Keep |
| academic_cohorts | UI_AND_BULK_IMPORT | Many cohorts per term | Yes | ACTIVE | Keep |
| elective_slot_courses | IMPORT_ONLY (primary) | Matrix data | Weak | ACTIVE | Keep; add light UI later |
| cohort_elective_selections | UI_AND_BULK_IMPORT | Academic decision — needs clearer UI | Weak | ACTIVE | **Gap:** UI approval journey |
| faculty_workload_policies | UI_ONLY | Policy decisions | **Missing** | No | **Must add UI** |
| instructor_availability / room_* | UI_ONLY | Interactive windows | `/availability` | Catalog-only sheets demote | Keep UI |
| time_slot_templates | UI_ONLY | Grid design | Yes | Catalog download only | SoT |
| time_slots | NOT_NEEDED (Pilot) | Superseded by templates | Deprecate | No | Hide |
| scheduling_settings / constraints / calendar | UI_ONLY | Interactive | Yes | Catalog demote | Keep |
| course_offerings (V2) | SYSTEM_GENERATED | From curriculum RPC | Diagnostic only | Legacy import only | Do not import in Pilot |
| delivery_groups | SYSTEM_GENERATED | From DG RPC | Read + generate | No | Keep |
| cohort_curriculum | SYSTEM_GENERATED | Offering set | Generate button | No | Keep |
| teaching_assignments V2 | UI_AND_BULK_IMPORT | After DGs exist | Yes | ACTIVE | Keep |
| teaching_assignments V1 / sections / COS / section_groups | LEGACY_ONLY | Compatibility | Hide sections | Hidden from `/import` | Isolate |
| schedule_versions / sessions / published | SYSTEM_GENERATED | Builder/lifecycle | Yes | Catalog `existing_schedule_sessions` → NOT_NEEDED | No import Pilot |
| conflict/quality results | SYSTEM_GENERATED | Engine outputs | Yes | No | Keep |
| users / roles | UI_ONLY | Security-sensitive | `/users` | No | Keep |

---

## Template catalog audit (every catalog id)

| Template ID | Columns? | Validator? | Commit handler? | Practical value | Show to user? | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| colleges | Yes | No atomic | No | Doc only | Optional doc | **REMOVE from import UX** / doc badge |
| departments | Yes | Yes | atomic | High | Yes | **KEEP — IMPORT_OR_UI** |
| programs | Yes | Yes | atomic | High | Yes | **KEEP — IMPORT_OR_UI** |
| academic_levels | Yes | No | No | Covered by plan import | No | **REMOVE / MERGE into plan** |
| academic_terms | Yes | Yes | atomic | High | Yes | **KEEP** |
| courses | Yes | Partial via plan | No standalone atomic | Medium | Prefer plan | **MERGE into full_study_plan** |
| study_plans | Yes | Via full | No standalone | Low alone | No | **MERGE** |
| plan_courses | Yes | Via study_plan_courses | custom | High | Yes (or via full) | **KEEP** (scoped) |
| full_study_plan | Yes | Yes | custom | **Highest** | Yes | **KEEP** |
| course_programs | Yes | Yes | custom | High | Yes | **KEEP** |
| instructors | Yes | Yes | table | High | Yes | **KEEP** |
| instructor_availability | Yes | No atomic | No | Low (UI better) | No | **REMOVE from catalog primary** |
| rooms | Yes | Yes | table | High | Yes | **KEEP** |
| room_availability | Yes | No | No | Low | No | **REMOVE** |
| room_unavailability | Yes | No | No | Medium | Optional | UI_ONLY prefer; catalog demote |
| daily_breaks | Yes | Yes | table | High | Yes | **KEEP** |
| time_slot_templates | Yes | No atomic | No | Medium as sample | Download-only OK | **KEEP as sample / not import** |
| academic_cohorts | Yes | Yes | custom | High | Yes | **KEEP** |
| elective_slot_courses | Yes | Yes | custom | High | Yes | **KEEP** |
| cohort_elective_selections | Yes | Yes | custom | High | Yes | **KEEP** |
| teaching_assignments_v2 | Yes | Yes | custom | High | Yes | **KEEP** |
| course_offerings | Yes | Legacy | Legacy | Harmful in Pilot | No | **LEGACY — hide** |
| teaching_assignments | Yes | Legacy | Legacy | Harmful | No | **LEGACY — hide** |
| sections | Yes | Legacy | Legacy | Harmful | No | **LEGACY — hide** |
| section_groups | Yes | Legacy | Legacy | Harmful | No | **LEGACY — hide** |
| existing_schedule_sessions | Yes | No Pilot path | No | Dangerous | No | **REMOVE** |
| constraint_settings | Yes | No | No | UI better | No | **REMOVE** |
| quality_settings | Yes | No | No | UI better | No | **REMOVE** |

### Keep / Remove / Merge summary

**KEEP (operational import):**
`departments`, `academic_programs`, `academic_terms`, `full_study_plan`, `study_plan_courses` (scoped), `course_programs`, `instructors`, `rooms`, `daily_breaks`, `academic_cohorts`, `elective_slot_courses`, `cohort_elective_selections`, `teaching_assignments_v2`

**MERGE:**
`courses` + `study_plans` + `plan_courses` + `academic_levels` → prefer `full_study_plan` (retain `study_plan_courses` for incremental)

**REMOVE from user-facing catalog (or mark documentation-only):**
`colleges`, `instructor_availability`, `room_availability`, `constraint_settings`, `quality_settings`, `existing_schedule_sessions`

**LEGACY hide (already largely hidden from `/import`):**
`sections`, `course_offerings`, `teaching_assignments`, `section_groups`

**SAMPLE / UI-managed downloads only:**
`time_slot_templates`

---

## `/import-templates` (DB table editor)

| Question | Finding |
| --- | --- |
| Distinct from Excel catalog? | Yes — `import_templates` / `import_template_columns` |
| Needed for Pilot? | **Unclear** — operational path is code registry + `/data-templates` + `/import` |
| Decision | Treat as **candidate HIDE/MERGE**; do not maintain two template authorities |

## Official management path rule

> Imports must not create SYSTEM_GENERATED entities.
> UI must not pretend Excel commit exists when `atomicImport: false`.
