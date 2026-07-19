# Target Domain Model

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`

## Classification legend

| Tag | Meaning |
| --- | --- |
| Manual | Entered in UI |
| Bulk | Excel import (atomic commit) |
| Generated | System RPC / engine |
| Derived | Read-only / report |
| Legacy | Compatibility only — not Pilot SoT |

## Mermaid — target academic + scheduling model

```mermaid
flowchart TB
  subgraph org [Institution - Manual]
    U[universities]
    C[colleges]
    D[departments]
    P[academic_programs]
    U --> C --> D --> P
  end

  subgraph academic [Academic structure]
    T[academic_terms - Manual/Bulk]
    CR[courses - Manual/Bulk via plan]
    SP[study_plans - Manual/Bulk]
    PC[plan_courses - Bulk/UI]
    PCC[plan_course_components - SoT hours]
    ES[elective_slots]
    ESC[elective_slot_courses - Bulk]
    P --> SP
    SP --> PC --> PCC
    SP --> ES --> ESC
    CR --> PC
    T --- AC
  end

  subgraph cohort [Cohort context - SoT students]
    AC[academic_cohorts - Manual/Bulk]
    CES[cohort_elective_selections - Bulk/UI]
    AC --> CES
    P --> AC
  end

  subgraph generated [Generated delivery]
    CO[course_offerings - Generated]
    DG[delivery_groups - Generated]
    AC -->|generate_cohort_curriculum| CO
    AC -->|generate_cohort_delivery_groups| DG
    PCC --> DG
  end

  subgraph teaching [Teaching]
    INS[instructors - Manual/Bulk]
    WP[faculty_workload_policies - Manual]
    TA[teaching_assignments V2 - Manual/Bulk]
    INS --> TA
    DG --> TA
    WP -.-> TA
  end

  subgraph rules [Scheduling rules]
    TST[time_slot_templates - Manual SoT grid]
    BR[daily_breaks - Manual/Bulk]
    SS[scheduling_settings - Manual]
    IAH[instructor Hard unavailability]
    IAS[instructor Soft preferences]
    RU[room_unavailability Hard]
    CS[college_constraint_settings structural]
  end

  subgraph schedule [Schedule]
    SV[schedule_versions - Manual create / lifecycle]
    SESS[schedule_sessions - Generated from TA in Builder]
    CF[conflict_results - Generated]
    QR[schedule_quality_runs - Generated]
    EX[approved exceptions - Manual]
    TA --> SESS
    SV --> SESS
    SESS --> CF
    SESS --> QR
    CF --> EX
  end

  subgraph legacy [Legacy compatibility - hidden]
    SEC[sections]
    COS[course_offering_sections]
    SG[section_groups]
  end

  subgraph authz [Identity]
    PR[profiles]
    UR[user_roles]
    UC[user_colleges]
  end
```

## One source of truth per concept

| Concept | Single SoT |
| --- | --- |
| Tenant | `colleges` |
| Program ownership | `academic_programs.department_id` |
| Student academic set | `academic_cohorts` |
| Curriculum membership | approved `study_plans` + `plan_courses` |
| Contact hours / component type | `plan_course_components` |
| Elective decision | `cohort_elective_selections` |
| Offering instance | generated `course_offerings` |
| Teaching split | generated `delivery_groups` |
| Who teaches what hours | V2 `teaching_assignments` |
| When/where taught | `schedule_sessions` |
| Time grid | `time_slot_templates` (+ `daily_breaks`, bounds from `scheduling_settings`) |
| Hard deny instructor/room | unavailability rows (`is_preference=false` / `room_unavailability`) |
| Soft preference | preference-flagged availability only |
| Structural rule weights | `college_constraint_settings` |
| Detected conflicts | `conflict_results` (never master-edited as rules) |
| Workload standard | `faculty_workload_policies` |
| Isolation axes | `college_id` + `study_system` (`regular`\|`parallel`) |

## Explicit non-SoT (must not drive Pilot)

- `sections`, `course_offering_sections`, `section_groups*`
- Manual `time_slots` as competing grid
- Legacy teaching_assignments without `delivery_group_id`
- Imported final timetable sessions (`existing_schedule_sessions`)
- Reports inventing domain rules

## Managed vs generated summary

| Manual | Bulk | Generated | Derived | Legacy |
| --- | --- | --- | --- | --- |
| Org tree, lookups, settings, constraints, availability, versions create, exceptions | terms, plans, instructors, rooms, breaks, cohorts, electives, TA V2 | offerings, DGs, sessions, conflicts, quality | reports, readiness views | sections, COS, section_groups, V1 TA/offerings import |
