# Stage 03I-G — Teaching Hours Contract Audit

Mission: `PLATFORM-LAUNCH-STAGE-03I-G-TEACHING-HOURS-CONTRACT-AUDIT-01`

Generated: 2026-07-29 (Asia/Riyadh)

## Scope and starting state

| Field                                         |                                    Value |
| --------------------------------------------- | ---------------------------------------: |
| Base                                          |        latest `origin/main` at `65e5848` |
| Canonical operations before hours remediation |                                      138 |
| Exact import blocker                          | `B-138-CO-TEACHING-HOURS-OVER-ALLOCATED` |
| V2 assignments                                |                                        0 |
| Legacy assignments                            |                                      174 |
| Production writes                             |                                        0 |
| Migration apply                               |                                     none |
| Lovable publish                               |                                     none |

This audit used source, deterministic fixtures, and the previously captured Stage 03I-F
read-only evidence. It did not query or mutate production.

## Contract reviewed

The server authority remains `commit_teaching_assignments_v2_import`, which locks delivery
groups and calls `validate_assignment_allocation_locked`. It rejects a delivery group when
the sum of active V2 `assigned_component_hours` exceeds the matched component
`weekly_contact_hours`.

The client preview previously canonicalized duplicates but did not execute the equivalent
hours gate before enabling confirmation. It also accepted an Excel hours value for a single
assignable component without requiring equality with the component weekly hours.

## Aggregation keys

Two different questions require two different keys:

| Gate                                | Exact key      | Limit        |
| ----------------------------------- | -------------- | ------------ | ----------------- | ------------------------------ | --------------------------------------------- |
| Delivery-group component allocation | `term_id       | study_system | delivery_group_id | component_id`                  | `plan_course_components.weekly_contact_hours` |
| Instructor weekly maximum           | `instructor_id | term_id      | study_system`     | `instructors.max_weekly_hours` |

`delivery_group_id` already identifies one cohort/system/term in the database, but term and
study system remain explicit in the audit key to prevent accidental cross-scope aggregation.

Academic-rank workload policies describe the standard/required teaching load. They are not
silently substituted for `max_weekly_hours`, which is the configured hard maximum used by
this preflight.

## Findings

| Requirement                      | Result                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| Legacy plus new V2 payload       | PASS — Legacy rows have no delivery group and are outside the V2 preflight input   |
| Two terms combined               | PASS — term is part of the instructor and DG keys                                  |
| Expansion doubles hours          | PASS — expanded theory/practical operations use each component's own weekly hours  |
| Identical source duplicates      | PASS — preflight receives canonical operations after identical collapse            |
| Conflicting groups               | PASS — local conflicting natural keys emit no canonical operation                  |
| Canonical operations only        | PASS — preflight API accepts the canonical array, not source rows                  |
| Regular and parallel combined    | PASS — study system is part of both relevant keys                                  |
| Theory/practical                 | PASS — separate component capacity keys; both count toward instructor weekly total |
| Multiple delivery groups         | PASS — separate capacity keys and one scoped instructor total                      |
| Exact instructor limit           | PASS                                                                               |
| One hour above instructor limit  | PASS — `INSTRUCTOR_TEACHING_HOURS_OVER_LIMIT`                                      |
| Co-teaching 2+2 against weekly 2 | PASS — `CO_TEACHING_HOURS_OVER_ALLOCATED`                                          |
| Valid 138-operation distribution | PASS — 138 DG keys and zero blockers                                               |

## Proven general defects and fixes

### 1. Single-component hours mismatch

Before: when only one component was assignable, `matchComponentsByHours` selected it even
when Excel hours exceeded or differed from its weekly hours. `toImportRow` then copied the
invalid source total into every produced operation.

Fix: a non-null source hours value must equal the single component weekly hours. Otherwise
the row is `AMBIGUOUS` and cannot enter the canonical payload. No clamping or silent rewrite
is performed.

### 2. Missing client-side canonical hours preflight

Before: the preview could enable confirmation for 138 canonical operations even though the
server would atomically reject co-teaching allocation.

Fix:

- canonical rows carry explicit term, component weekly hours, and instructor maximum metadata;
- `preflightCanonicalTeachingHours` audits only canonical V2 operations;
- delivery-group/component and instructor scopes are calculated separately;
- hours errors remain visible and disable confirmation;
- the server RPC remains authoritative and unchanged.

No migration or database function was changed.

## Test coverage

The new harness covers:

- one instructor in two terms;
- regular and parallel;
- theory and practical;
- multiple delivery groups;
- identical duplicates;
- local conflicts;
- 174 Legacy records alongside a V2 dry-run;
- exact weekly maximum;
- one-hour excess;
- co-teaching component over-allocation;
- 138 canonical operations with a valid distribution.

The source-workbook harness also proves that a single component no longer accepts mismatched
source hours.

## Validation

| Command/check          | Result                     |
| ---------------------- | -------------------------- |
| `git diff --check`     | PASS                       |
| `bunx tsc --noEmit`    | PASS                       |
| `bun run build`        | PASS                       |
| `bun test`             | PASS — 4 passed, 0 failed  |
| `bun run test:harness` | PASS — 52 passed, 0 failed |
| Changed-file ESLint    | PASS                       |

## Security review

| Item              | Result |
| ----------------- | ------ |
| Production writes | none   |
| Migration apply   | none   |
| New migration     | none   |
| RLS/RPC changes   | none   |
| Lovable publish   | none   |
| PR merge          | none   |
| Legacy mutation   | none   |

## FINAL_DECISION

`READY_FOR_TEACHING_HOURS_DATA_REMEDIATION`

The general contract defects are fixed and covered. The historical 138-operation payload is
still data-invalid until it is re-previewed from corrected source hours; this mission does
not rewrite those hours or execute the import.
