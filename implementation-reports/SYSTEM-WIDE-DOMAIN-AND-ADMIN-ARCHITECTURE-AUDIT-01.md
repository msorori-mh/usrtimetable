# SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01

**Decision:** `PASS_WITH_FINDINGS — SYSTEM_ARCHITECTURE_AUDIT_COMPLETE`
**Date:** 2026-07-19 (Asia/Riyadh)
**Repository:** `msorori-mh/usrtimetable`
**Worktree:** `C:\projects\usrtimetable-full-system-architecture-audit`
**Branch:** `codex/full-system-architecture-audit`

## Decision

Architecture audit completed from source contracts (routes, types, migrations text, import registry, services).
**No application source behavior changes. No DB writes. No migration apply. No Deploy/Publish.**

Findings are substantial; remediation is planned only (`docs/SYSTEM-REMEDIATION-ROADMAP.md`).

---

## Baseline

| Item | Value |
| --- | --- |
| HEAD / baseline SHA | `c6b0d861f006d4202349bfa77ed24a5508e2b727` |
| `origin/main` | `c6b0d861f006d4202349bfa77ed24a5508e2b727` |
| Freeze record | `docs/ARCHITECTURE_FREEZE_FOR_AUDIT.md` |
| Project state posture | `ARCHITECTURE_FREEZE_FOR_AUDIT` |
| Open PRs at freeze | #30 (Phase 9.2 imports — isolated/conflicting history), #38 (lifecycle transitions) |
| Migration files | 105 |
| Remote applied/pending | **UNKNOWN** |
| Last DB state doc | `docs/TIMETABLE-PROJECT-EXECUTION-STATE.md` (2026-07-18): runtime UNKNOWN, production UNCHANGED |

---

## Inventory counts

| Metric | Count |
| --- | ---: |
| Sidebar routes / nav items | 38 labels / 42 `to` entries (harness) |
| Authenticated route modules | 57 |
| Report child routes | 12 |
| Hidden authenticated routes | 2 |
| Domain tables (types) | 61 (+ view) |
| Entities in SoT matrix | 40+ concepts |
| Catalog templates | 28 |
| ACTIVE_NEW_FLOW import entities | 11 |
| LEGACY_ONLY import entities | 4 |
| GENERATED_NOT_IMPORTED concepts | 6 |

---

## Findings by severity (aggregate)

| Severity | Count (approx) |
| --- | ---: |
| BLOCKER | 8 |
| HIGH | 14 |
| MEDIUM | 10 |
| LOW | 2 |
| UX | 5 |
| LEGACY_DEBT | 3 |

Primary registers:

- `docs/DUPLICATION-OVERLAP-CONFLICT-REGISTER.md`
- `docs/ADMIN-VISUAL-AND-AUTHZ-AUDIT-NOTES.md` (G8–G10)

---

## Duplications / overlaps / conflicts (top)

1. Legacy `/sections` labeled «المجموعات الدراسية» vs cohorts vs delivery groups
2. Competing time grids: `time_slots` vs `time_slot_templates` (+ settings/breaks)
3. Three data/template centers: data-templates / import / import-templates
4. Hard vs Soft availability mixed in one UX/table flag
5. Course hours duplicated across courses / plan_courses / components
6. Dual plan import templates (`full_study_plan` vs `study_plan_courses`) without wizard
7. Teaching assignments V1 Legacy vs V2 in one table
8. course_offerings generated vs Legacy import meaning
9. Schedule builder vs auto-schedule vs hidden legacy timetable
10. Data readiness page vs readiness report

---

## Gaps (top)

1. `faculty_workload_policies` — **no admin UI**
2. Legacy sections still in primary nav
3. Elective approval journey under-served
4. Approval/publish checklist fragmented; remote lifecycle migrations unproven
5. Next-step guidance weak outside cohort summaries
6. Audit log viewer missing
7. Misleading report names (section/department)
8. Catalog shows non-importable foundational templates
9. URL reachability without page-level AuthZ on many pages
10. Visual authenticated sweep incomplete (no browser MCP / pending session)

---

## Legacy pages (user-visible or reachable)

| Surface | Disposition |
| --- | --- |
| `/sections` | **HIDE** from Pilot nav |
| `/reports/department-schedule` | **HIDE** |
| `/reports/section-timetable` | **RENAME** |
| `/timetable/$versionId` | Keep hidden / retire |
| `/course-offerings` | Hidden diagnostic OK |
| Legacy import entities | Already hidden from `/import` UI |

---

## Import templates — keep / remove / merge

**Keep:** academic_terms, full_study_plan, study_plan_courses (scoped), course_programs, instructors, rooms, daily_breaks, academic_cohorts, elective_slot_courses, cohort_elective_selections, teaching_assignments_v2

**Merge:** courses / study_plans / levels → full_study_plan primary

**Remove from user catalog (or doc-only):** colleges, departments, programs, instructor_availability, room_availability, constraint_settings, quality_settings, existing_schedule_sessions

**Legacy hide:** sections, course_offerings, teaching_assignments, section_groups

Detail: `docs/IMPORT-VS-UI-VS-GENERATED-DECISION-MATRIX.md`

---

## Target domain model & navigation

- Model: `docs/TARGET-DOMAIN-MODEL.md`
- Nav: `docs/TARGET-ADMIN-INFORMATION-ARCHITECTURE.md`
- Rules: `docs/SYSTEM-SINGLE-SOURCE-OF-TRUTH-RULES.md`
- Workflow: `docs/END-TO-END-ADMIN-WORKFLOW-MAP.md`
- Entity matrix: `docs/DOMAIN-ENTITY-SOURCE-OF-TRUTH-MATRIX.md`
- Routes inventory: `docs/ADMIN-ROUTES-AND-CAPABILITIES-INVENTORY.md`

**Target teaching chain:**
Plan → Cohort → Elective selections → Curriculum offerings → Delivery groups → Teaching assignments → Schedule sessions

---

## Launch blockers

1. Hide Legacy sections + quarantine Legacy reports
2. Single time-grid SoT (templates); hide manual time_slots
3. Workload policies UI
4. Simplify import/template IA; remove false catalog capabilities
5. Prove/apply gated runtime migrations (curriculum, lifecycle, import atomic, tenant FK) **with user approval**
6. Elective approval + generate curriculum clarity in cohort hub
7. Hard/Soft IA split

Roadmap: `docs/SYSTEM-REMEDIATION-ROADMAP.md` (Phases A–G)

---

## Post-launch improvements

- Import order wizard
- Audit log viewer
- Deep Legacy table retirement
- Readiness merge polish
- Broader report cohort coverage
- Dead route cleanup after migration window

---

## Quality gates (this audit)

| Gate | Result |
| --- | --- |
| Static route inventory harness | **PASS** (`admin-routes-inventory.harness.ts`) |
| Domain-contract static harness | **PASS** (`domain-contract-static.harness.ts`) |
| Registered in `tests/harness/run.mjs` | Yes |
| TypeScript (`tsc --noEmit`) | **PASS** |
| Production build | **PASS** |
| Product `src/**` behavior changes | **None** (docs + static harness only) |
| `git diff --check` (audit paths) | **PASS** |
| DB writes | **None** |
| Migration apply | **None** |
| Deploy/Publish | **None** |

### Local visual audit

- Screenshots folder created outside Git
- Authenticated browser sweep: **PENDING** (MCP browser unavailable; capture index prepared)
- Static UI contract review completed

---

## Deliverable index

| Artifact |
| --- |
| `docs/ARCHITECTURE_FREEZE_FOR_AUDIT.md` |
| `docs/ADMIN-ROUTES-AND-CAPABILITIES-INVENTORY.md` |
| `docs/DOMAIN-ENTITY-SOURCE-OF-TRUTH-MATRIX.md` |
| `docs/DUPLICATION-OVERLAP-CONFLICT-REGISTER.md` |
| `docs/IMPORT-VS-UI-VS-GENERATED-DECISION-MATRIX.md` |
| `docs/TARGET-ADMIN-INFORMATION-ARCHITECTURE.md` |
| `docs/END-TO-END-ADMIN-WORKFLOW-MAP.md` |
| `docs/TARGET-DOMAIN-MODEL.md` |
| `docs/SYSTEM-REMEDIATION-ROADMAP.md` |
| `docs/SYSTEM-SINGLE-SOURCE-OF-TRUTH-RULES.md` |
| `docs/ADMIN-VISUAL-AND-AUTHZ-AUDIT-NOTES.md` |
| `implementation-reports/SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01.md` |
| `tests/harness/admin-routes-inventory.harness.ts` |
| `tests/harness/domain-contract-static.harness.ts` |

---

## Git / PR

| Item | Value |
| --- | --- |
| Commit | `2554704fe4e24603cc15965270197eaa4314ddf1` |
| Draft PR | https://github.com/msorori-mh/usrtimetable/pull/55 |
| Merge | Not performed — awaiting user review |

## Final decision

**PASS_WITH_FINDINGS — SYSTEM_ARCHITECTURE_AUDIT_COMPLETE**

Next step for humans: **USER REVIEW OF SYSTEM REMEDIATION ROADMAP.**
