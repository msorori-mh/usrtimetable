# System Remediation Roadmap

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`
**Delta refresh:** `1af8787e676f6040b824dc3e177b3aacbcfdaec2`
**Note:** Design only — **no fixes executed in this audit.**

Complexity: S / M / L · Launch: REQUIRED / POST_LAUNCH

---

## Phase A — Launch blockers

### A01 — Hide Legacy sections from primary admin path
| | |
| --- | --- |
| Description | Remove `/sections` from sidebar; gate route; rename residual to Legacy |
| Affected files | `app-layout.tsx`, `sections.tsx`, reports section timetable labels |
| DB impact | None (UI quarantine) |
| Migration | No |
| Dependencies | None |
| Risk | Low if Legacy still URL-reachable for break-glass |
| Tests | Nav harness; unauthorized/legacy visibility |
| Complexity | S |
| Launch | **REQUIRED** |

### A02 — Declare single time-grid SoT; hide manual `time_slots`
| | |
| --- | --- |
| Description | Nav + copy: templates + breaks + scheduling_settings only |
| Affected files | `app-layout.tsx`, `time-slots.tsx`, builder/conflict docs |
| DB impact | None initially |
| Migration | No (optional later drop) |
| Dependencies | Confirm builder/conflict already use templates |
| Risk | Medium if any college data only in `time_slots` |
| Tests | Time template harnesses |
| Complexity | S |
| Launch | **REQUIRED** |

### A03 — Workload policies admin UI
| | |
| --- | --- |
| Description | CRUD page for `faculty_workload_policies` under تدريس/النصاب |
| Affected files | new route, nav, possibly workload service |
| DB impact | None (table exists) |
| Migration | No |
| Dependencies | TA V2 workload RPCs |
| Risk | Medium (policy semantics) |
| Tests | Workload engine harness + UI smoke |
| Complexity | M |
| Launch | **REQUIRED** |

### A04 — Quarantine competing template authorities
| | |
| --- | --- |
| Description | Single data hub; hide `/import-templates` or mark advanced; simplify catalog |
| Affected files | `app-layout.tsx`, `data-templates`, catalog classifications |
| DB impact | None |
| Migration | No |
| Dependencies | Import decision matrix |
| Risk | Low |
| Tests | import-templates-final-audit harness |
| Complexity | S |
| Launch | **REQUIRED** |

### A05 — Prove remote migration/runtime for curriculum + lifecycle + import atomic
| | |
| --- | --- |
| Description | User-approved apply plan after history reconciliation — outside UI redesign |
| Affected files | migrations (apply only with approval) |
| DB impact | **Yes — gated** |
| Migration | **Yes — explicit approval** |
| Dependencies | Supabase admin access; user decisions in TIMETABLE-DECISIONS-NEEDED |
| Risk | High |
| Tests | Disposable PG + post-apply verification |
| Complexity | L |
| Launch | **REQUIRED** (runtime) |

### A06 — Block Pilot writes to Legacy section/offering import paths in UI
| | |
| --- | --- |
| Description | Ensure `/import` stays NEW_FLOW only; prevent accidental Legacy CRUD prominence |
| Affected files | import UI, sections page gate |
| DB impact | None |
| Migration | No |
| Dependencies | A01 |
| Risk | Low |
| Tests | Import registry harness |
| Complexity | S |
| Launch | **REQUIRED** |

### A07 — Replace ambiguous shared-course terminology and enforce the shared-delivery lock
| | |
| --- | --- |
| Description | Rename `/shared-courses` labels to catalog program/department associations; state that these links never merge cohort delivery. Reject any inferred cross-cohort delivery until an explicit model is approved. |
| Affected files | `shared-courses.tsx`, navigation/copy, labels harness, admin help text |
| DB impact | None for terminology. A future shared-delivery model is a separate decision and is out of scope. |
| Migration | No |
| Dependencies | Binding cohort/DG model; G02 terminology sweep |
| Risk | High if operators interpret “shared” as permission to combine cohorts or capacity |
| Tests | Labels harness; cohort ownership assertions; negative cross-cohort fixtures |
| Complexity | S for terminology; future model not estimated |
| Launch | **REQUIRED** |

---

## Phase B — Domain consolidation

### B01 — Hours SoT messaging + validation
| Description | UI/validators: components own contact hours |
| Affected | courses, study-plans, import validators |
| DB | Possibly CHECK later |
| Migration | Optional |
| Complexity | M · Launch REQUIRED |

### B02 — Elective approval UX on cohort hub
| Description | First-class selections UI before generate curriculum |
| Affected | academic-cohorts, maybe new tab |
| Complexity | M · Launch REQUIRED |

### B03 — Teaching hub consolidation
| Description | Cohort → offerings summary → DG → TA linked steps |
| Affected | cohorts, delivery-groups, teaching-assignments |
| Complexity | M · Launch REQUIRED |

### B04 — Dual TA/offering Legacy column documentation + write guards
| Description | Prevent new Legacy-shaped rows in Pilot |
| DB | Optional constraints |
| Complexity | M · Launch REQUIRED if writes still possible |

---

## Phase C — Admin navigation redesign

### C01 — Implement target IA groups
| Description | Restructure `NAV` per TARGET-ADMIN-INFORMATION-ARCHITECTURE |
| Affected | `app-layout.tsx`, breadcrumbs/copy |
| Complexity | M · Launch REQUIRED |

### C02 — Merge readiness surfaces
| Description | One readiness entry |
| Complexity | S · POST_LAUNCH acceptable if linked |

### C03 — Rename misleading reports
| Description | section-timetable → cohort/DG; hide department Legacy |
| Complexity | S · Launch REQUIRED |

---

## Phase D — Import simplification

### D01 — Apply keep/remove/merge on catalog
| Description | Per IMPORT-VS-UI-VS-GENERATED matrix |
| Affected | `catalog.ts`, data-templates UI |
| Complexity | M · Launch REQUIRED |

### D02 — Import order wizard mirroring `OFFICIAL_IMPORT_ORDER`
| Description | Guided steps + generate checkpoints |
| Complexity | M · POST_LAUNCH |

### D03 — Resolve draft atomic import PR strategy
| Description | Server-side dispatcher (tracked historically as PR #45 area) |
| DB | Migration likely |
| Complexity | L · Launch REQUIRED for safe bulk |

---

## Phase E — Legacy isolation

### E01 — Feature-flag Legacy routes/reports
### E02 — Compatibility adapter docs only for section_id
### E03 — Post-launch drop plan for Legacy tables
| Complexity | M–L · E01 REQUIRED; E03 POST_LAUNCH |

---

## Phase F — UX and reports

### F01 — Split Hard vs Soft availability IA
### F02 — Next-step CTAs on cohort/assignment/version pages
### F03 — Approval/publish checklist UI
### F04 — Audit log viewer
### F05 — Cohort-centric reports completeness
| Launch | F01–F03 closer to REQUIRED; F04–F05 POST_LAUNCH OK |

---

## Phase G — Cleanup and launch

### G01 — Remove dead nav/routes after migration window
### G02 — Terminology sweep (labels harness)
### G03 — Final launch checklist vs readiness report
### G04 — Close conflicting stale PRs (#30) or rebase consciously
| Complexity | S–M · Launch REQUIRED for G02–G03 |

---

## Launch vs post-launch

| REQUIRED for initial launch | POST_LAUNCH |
| --- | --- |
| A01–A07, B01–B04, C01, C03, D01, D03, E01, F01–F03, G02–G03 | C02, D02, E03, F04–F05, G01 polish |

## Estimated launch readiness (architecture)

**Not launch-ready** until Phase A blockers cleared and remote runtime proven.
Source maturity is strong in builder/conflicts; weakest in IA clarity, workload UI, import atomicity proof, and Legacy leakage.
