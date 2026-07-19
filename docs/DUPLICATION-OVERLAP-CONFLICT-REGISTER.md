# Duplication / Overlap / Conflict Register

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`

Severity: BLOCKER · HIGH · MEDIUM · LOW · UX · LEGACY_DEBT

---

## A. Programs and departments

### DUP-A01 — Multiple mental models for program creation
| Field | Value |
| --- | --- |
| Components | `/programs` UI, catalog template `programs` (UI_MANAGED), departments page |
| Type | Overlap / false import path |
| User impact | User may download “programs” template expecting Excel import that cannot commit |
| Data impact | None if unused; confusion delays setup |
| Severity | MEDIUM |
| Proposed | Keep UI-only creation; remove or badge catalog rows as «واجهة فقط — بلا استيراد» |
| Keep / Merge / Remove | Keep `/programs`; demote catalog foundational sheets |
| Dependency | Import catalog simplification (Phase D) |

### DUP-A02 — College vs department confusion
| Field | Value |
| --- | --- |
| Components | colleges, departments, my-college |
| Type | Conceptual overlap (not data duplication) |
| User impact | College admins see «كلّيتي» while structure lives under academic nav |
| Severity | UX |
| Proposed | Target IA: التأسيس المؤسسي groups university→college→dept→program |
| Dependency | Nav redesign |

### DUP-A03 — Program without department?
| Field | Value |
| --- | --- |
| Components | `academic_programs.department_id NOT NULL`, programs UI requires department |
| Type | **Compliant** (not a defect) |
| Severity | — |
| Note | Schema + UI enforce mandatory department. No alternate create path found that skips department. |

---

## B. Plans and courses

### DUP-B01 — Course hours stored in multiple places
| Field | Value |
| --- | --- |
| Components | `courses` theory/practical hours, `plan_courses` weekly hours, `plan_course_components.weekly_contact_hours` |
| Type | Data duplication / ambiguous SoT |
| User impact | Unclear which hours drive timetabling and workload |
| Data impact | Drift between catalog and plan |
| Severity | HIGH |
| Proposed | Rule: components = contact-hours SoT for scheduling/workload; course hours = catalog metadata only |
| Keep | plan_course_components as SoT |
| Dependency | Single-source rules + UI copy |

### DUP-B02 — Dual plan import templates
| Field | Value |
| --- | --- |
| Components | `full_study_plan`, `study_plan_courses` |
| Type | Overlapping import paths |
| User impact | Unclear which template to use |
| Severity | MEDIUM |
| Proposed | Keep both with explicit scopes: full vs single-level/semester; hide one in default UI or wizard step |
| Dependency | Import simplification |

### DUP-B03 — Study plans UI vs Excel plan import
| Field | Value |
| --- | --- |
| Components | `/study-plans`, `/import` full_study_plan |
| Type | Dual entry |
| Severity | MEDIUM |
| Proposed | UI for small edits; bulk for founding plans — document officially |

---

## C. Cohorts / groups / sections

### DUP-C01 — «المجموعات الدراسية» labels Legacy sections
| Field | Value |
| --- | --- |
| Components | `/sections` (nav: المجموعات الدراسية), `sections` table, vs `academic_cohorts`, `delivery_groups` |
| Type | Naming conflict / Legacy leakage |
| User impact | Operators create sections thinking they create cohorts or teaching groups |
| Data impact | Parallel Legacy data diverges from V2 chain |
| Severity | **BLOCKER** |
| Proposed | Hide from nav; rename residual to «شعب Legacy»; cohorts = دفعة; DG = مجموعات التدريس |
| Remove from user path | sections CRUD after migration |
| Dependency | Phase E Legacy isolation |

### DUP-C02 — Delivery groups page vs cohort-embedded DG table
| Field | Value |
| --- | --- |
| Components | `/delivery-groups`, `/academic-cohorts` groups panel |
| Type | UI duplication |
| Severity | MEDIUM |
| Proposed | Cohorts = generate+manage; college-wide page = diagnostic or merge under تدريس |

### DUP-C03 — Report «جدول المجموعة» still section-centric
| Field | Value |
| --- | --- |
| Components | `/reports/section-timetable` |
| Type | Terminology debt |
| Severity | HIGH / UX |
| Proposed | RENAME to cohort/delivery-group timetable; hide section report |

### DUP-C04 — course_offering_sections + section_groups vs delivery_groups
| Field | Value |
| --- | --- |
| Components | Legacy tables vs `delivery_groups` |
| Type | Domain overlap |
| Severity | LEGACY_DEBT |
| Proposed | Legacy isolation; no new writes in Pilot |

---

## D. Availability / preferences / constraints / conflicts

### DUP-D01 — Hard and Soft in one instructor table
| Field | Value |
| --- | --- |
| Components | `instructor_availability.is_preference`, availability UI select Hard/Soft |
| Type | Conceptual mixing (same storage) |
| User impact | Soft prefs may be treated as hard or ignored inconsistently |
| Severity | HIGH |
| Proposed | Keep storage if needed, but IA: separate nav «عدم التوفر (Hard)» vs «تفضيلات (Soft)»; engine must honor flag |
| Keep | Single table OK; split UX |

### DUP-D02 — Room availability vs unavailability
| Field | Value |
| --- | --- |
| Components | `room_availability`, `room_unavailability`, same `/availability` page |
| Type | Acceptable split, weak labeling |
| Severity | UX |
| Proposed | Label Hard blocks vs open windows clearly |

### DUP-D03 — Constraints vs conflicts vs preferences
| Field | Value |
| --- | --- |
| Components | `college_constraint_settings`, conflict_results, availability prefs |
| Type | Risk of double-encoding rules |
| Severity | MEDIUM |
| Proposed | Rules: constraints = structural weights only; unavailability = Hard deny; preferences = Soft; conflicts = detected outcomes (never re-entered as master data) |

### DUP-D04 — Operating calendar split across three screens
| Field | Value |
| --- | --- |
| Components | scheduling_settings, academic_calendar, daily_breaks |
| Type | Overlap |
| Severity | MEDIUM |
| Proposed | Target IA groups under «تقويم التشغيل» with clear roles |

---

## E. Time slots

### DUP-E01 — Competing time grids
| Field | Value |
| --- | --- |
| Components | `time_slots` page «فترات يدوية», `time_slot_templates` used by conflict/auto/builder, `scheduling_settings` day/hour bounds |
| Type | **Conflict of SoT** |
| User impact | Operator fills wrong grid; scheduler ignores it |
| Data impact | Orphan manual slots |
| Severity | **BLOCKER** |
| Proposed | Official SoT = `time_slot_templates` (+ breaks + scheduling_settings bounds). Hide or deprecate `time_slots` UI for Pilot |
| Keep | templates + breaks + settings |
| Remove/Hide | `/time-slots` from primary nav |

---

## F. Assignment and workload

### DUP-F01 — Workload policy table without UI
| Field | Value |
| --- | --- |
| Components | `faculty_workload_policies`, workload RPCs, instructor max_*_hours, `/reports/instructor-workload` |
| Type | Gap + overlap of knobs |
| Severity | **BLOCKER** |
| Proposed | Add policies UI OR document instructor max hours as temporary SoT; report must not invent rules |

### DUP-F02 — Teaching assignments V1 import vs V2
| Field | Value |
| --- | --- |
| Components | Legacy `teaching_assignments` import, `teaching_assignments_v2`, one table |
| Type | Dual write paths |
| Severity | HIGH |
| Proposed | LEGACY_ONLY hide; V2 only in Pilot |

### DUP-F03 — Course offerings vs assignments vs availability
| Field | Value |
| --- | --- |
| Components | offerings (what is taught), TA (who teaches), availability (when can teach) |
| Type | Correct separation — messaging weak |
| Severity | UX |
| Proposed | Workflow map + next-step CTAs |

---

## G. Scheduling surfaces

### DUP-G01 — Builder vs auto vs legacy timetable
| Field | Value |
| --- | --- |
| Components | `/schedule-builder`, `/auto-schedule`, `/timetable/$versionId` |
| Type | Overlapping editors |
| Severity | HIGH |
| Proposed | Builder = primary; auto = assist into draft; hide legacy timetable route |

### DUP-G02 — Versions / published / published report
| Field | Value |
| --- | --- |
| Components | schedule-versions, published-schedules, reports/published-timetable |
| Type | Mild overlap (acceptable stages) |
| Severity | LOW |
| Proposed | Keep; unify labels «مسودة / مراجعة / منشور» |

### DUP-G03 — Conflict checks page vs conflicts report vs quality
| Field | Value |
| --- | --- |
| Components | conflict-checks, reports/conflicts, schedule-quality, quality-summary |
| Type | Overlap |
| Severity | MEDIUM |
| Proposed | Checks = run action; reports = read; quality = score — clarify in nav |

---

## H. Data ops

### DUP-H01 — Three template/import entry points
| Field | Value |
| --- | --- |
| Components | `/data-templates`, `/import`, `/import-templates` (DB), plus cleanup/readiness |
| Type | IA duplication |
| Severity | HIGH |
| Proposed | One «البيانات» hub: download · import · history · readiness · cleanup; retire DB import-templates from primary nav unless proven needed |

### DUP-H02 — Data readiness page vs readiness report
| Field | Value |
| --- | --- |
| Components | `/data-readiness`, `/reports/data-readiness` |
| Type | Duplicate surface |
| Severity | MEDIUM |
| Proposed | MERGE into one readiness experience |

### DUP-H03 — Catalog templates without atomic commit
| Field | Value |
| --- | --- |
| Components | colleges, departments, programs, academic_levels, courses, study_plans, instructor_availability, time_slot_templates, constraint_settings, quality_settings, existing_schedule_sessions, … |
| Type | False capability |
| Severity | HIGH |
| Proposed | Decision matrix: keep download as documentation OR remove from user-facing catalog |

---

## Counts by severity (this register)

| Severity | Count |
| --- | ---: |
| BLOCKER | 3 (C01, E01, F01) |
| HIGH | 8 |
| MEDIUM | 9 |
| LOW | 1 |
| UX | 4 |
| LEGACY_DEBT | 1 |
| Compliant notes | 1 (A03) |
