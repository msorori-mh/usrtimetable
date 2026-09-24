# CODEX STAGE 03I-L — Co-teacher Assigned-hours Separation

Mission: `PLATFORM-LAUNCH-STAGE-03I-L-CO-TEACHER-ASSIGNED-HOURS-SEPARATION-01`

Generated: 2026-07-29 (Asia/Riyadh)

## ROOT_CAUSE

The academic-source parser had only one hours channel: `اجمالي الساعات` was stored as
`ParsedSourceRow.totalHours`. On `origin/main`, `toImportRow` in
`src/lib/excel-import/teaching-assignments-source-resolver.ts:406-416` derived
`perComponentHours` from that same value and wrote it directly to
`assigned_component_hours`.

Consequently, FR231 source rows 82 and 118 each retained the correct component total of 2,
but the resolver copied 2 to both EMP012 and EMP017 in each regular/parallel delivery
group. The canonical payload therefore represented 2+2 against a two-hour component.
Changing the Excel total to 1 targeted the wrong meaning and correctly triggered strict
component matching, reducing READY from 93 to 89 and canonical operations from 87 to 83.

The following paths were reviewed:

- parser/source-row model:
  `teaching-assignments-source-schema.ts` and `teaching-assignments-source-parser.ts`;
- component matching and source expansion:
  `teaching-assignments-source-resolver.ts`;
- duplicate handling:
  `teaching-assignments-v2-canonical.ts`;
- canonical hours validation:
  `teaching-assignments-v2-hours-preflight.ts`;
- preview/import orchestration and payload persistence:
  `teaching-assignments-source-import.ts`, `import.tsx`, and `commit.ts`;
- server payload extraction:
  `20260728010000_teaching_assignments_v2_duplicate_contract.sql`;
- the consolidated Stage 03I-F evidence, Stage 03I-G/J reports, and the supplied read-only
  Stage 03I-K hours-path analysis (which carries the Stage 03I-H/I baseline evidence).

The only production path that assigned both meanings from one value was the old resolver
copy at `origin/main:teaching-assignments-source-resolver.ts:406-416`. The Stage 03I-J
fixture mirrored that old model by initially setting both `_component_weekly_hours` and
`assigned_component_hours` to 2, then applying a test-only 1+1 overlay. Canonicalization,
preflight, and the server import extractor consumed `assigned_component_hours`; they did
not provide the missing source channel.

## PREVIOUS_HOURS_MODEL

| Meaning | Previous source | Previous consumer |
|---|---|---|
| Component matching total | `اجمالي الساعات` / `totalHours` | component matching |
| Instructor-assigned hours | the same `totalHours` copied by `toImportRow` | canonical payload and instructor load |
| Co-teacher behavior | full total copied to every instructor | 2+2 over-allocation for FR231 |

The preflight previously checked only over-allocation and left invalid canonical operations
inside the reported READY/canonical arrays.

## FINAL_HOURS_MODEL

| Field | Source and meaning | Allowed use |
|---|---|---|
| `component_total_hours` | the matched component total originating from `اجمالي الساعات` | component matching and equality with plan component hours |
| `assigned_component_hours` | the explicit hours for one instructor | canonical import payload, delivery-group allocation, and instructor workload |

For a multi-component aggregate source row, component expansion keeps the existing strict
match and materializes each authoritative plan-component total; it never treats the
aggregate row total as every instructor's per-component load.

The canonical import SQL continues to extract only `_assigned_component_hours` or
`assigned_component_hours`. `component_total_hours` is validation/preview metadata and is
never substituted as instructor workload except through the documented single-teacher
fallback.

## SUPPORTED_COLUMN_ALIASES

- `assigned_component_hours`
- `assigned hours`
- `ساعات المحاضر`
- `الساعات المسندة`
- `ساعات الإسناد`

Matching trims headers and treats English casing consistently.

## SINGLE_TEACHER_BEHAVIOR

If a delivery-group/component/term/study-system group has exactly one unique instructor and
no explicit assigned value, `assigned_component_hours = component_total_hours`. This is the
only fallback.

## CO_TEACHER_BEHAVIOR

If a group has more than one unique instructor, every instructor must have an explicit
assigned value. A missing value blocks the affected group with
`CO_TEACHER_ASSIGNED_HOURS_REQUIRED`. There is no automatic split, inferred distribution,
or ordering-based fallback.

Identical source duplicates are canonicalized before allocation totals and therefore do not
double hours. Conflicting natural keys remain excluded and BLOCKED.

## VALIDATION_RULES

The exact group key is:

`delivery_group_id + component_id + term_id + study_system`

For each group:

- `component_total_hours` must equal the matched plan component weekly hours;
- every `assigned_component_hours` must be finite and positive;
- missing assigned hours produce `CO_TEACHER_ASSIGNED_HOURS_REQUIRED`;
- a sum above the component total produces `CO_TEACHING_HOURS_OVER_ALLOCATED`;
- a sum below the component total produces `CO_TEACHING_HOURS_UNDER_ALLOCATED`;
- zero produces `ASSIGNED_HOURS_MUST_BE_POSITIVE` and, when applicable, under-allocation;
- numeric fractions are supported because the source, TypeScript contract, and database
  target are numeric; 0.5+1.5 is valid against total 2;
- regular/parallel, different terms, and Legacy assignments never share an allocation key.

Any natural key blocked by hours validation is removed from `validRows` and the canonical
import count. Preview exposes `component_total_hours`, `assigned_component_hours`,
`co_teacher_count`, `co_teaching_group_total`, and validation status for every expanded
source result.

## READY_EXPECTED

`93`

The corrected dry-run fixture keeps the Excel/component total at 2 and assigns EMP012=1 and
EMP017=1 in both regular and parallel groups.

## CANONICAL_EXPECTED

`87`

Six identical source duplicates remain collapsed. The four FR231 operations remain READY
because only instructor-assigned hours change; component totals and natural keys do not.

The missing-assigned-hours fixture proves the fail-closed counterfactual: four operations
are BLOCKED, leaving only 89 READY source rows and 83 canonical operations.

## STRICT_DOWNGRADES_PRESERVED

`63`

All remain `AMBIGUOUS` and none is promoted by the assigned-hours separation.

## FILES_CHANGED

- `src/lib/excel-import/teaching-assignments-source-schema.ts`
- `src/lib/excel-import/teaching-assignments-source-parser.ts`
- `src/lib/excel-import/teaching-assignments-source-resolver.ts`
- `src/lib/excel-import/teaching-assignments-v2-canonical.ts`
- `src/lib/excel-import/teaching-assignments-v2-hours-preflight.ts`
- `src/lib/excel-import/templates.ts`
- `src/routes/_authenticated/import.tsx`
- `tests/fixtures/teaching-assignments-targeted-hours/stage-03i-j.ts`
- `tests/harness/teaching-assignments-source-workbook-import.harness.ts`
- `tests/harness/teaching-assignments-v2-hours-preflight.harness.ts`
- `tests/harness/stage-03i-j-targeted-hours-remediation.harness.ts`
- this report

No migration, production data, or real Excel workbook was modified.

## TESTS_ADDED

Regression coverage proves:

1. single teacher total 2 with no assigned column falls back to 2;
2. co-teachers 1+1 are valid;
3. missing co-teacher values are BLOCKED;
4. 2+2 is over-allocated;
5. 1+0 is invalid and under-allocated;
6. 0.5+1.5 is valid;
7. regular and parallel are separate;
8. terms are separate;
9. Legacy rows are excluded;
10. identical duplicates do not double hours;
11. conflicts remain blocked;
12. corrected FR231 fixture is 93 READY / 87 canonical / 0 invalid / 0 instructor
    over-allocation / dry-run true;
13. missing FR231 assigned hours block all four operations with no false READY;
14. all 63 strict downgrades remain excluded.

All five assigned-hours header aliases are parsed by deterministic tests.

## TEST_RESULTS

| Gate | Result |
|---|---|
| `bun install --frozen-lockfile` | PASS — locked dependencies unchanged |
| `git diff --check` | PASS |
| changed-file ESLint | PASS — 0 errors |
| `bunx tsc --noEmit` | PASS |
| `bun run build` | PASS |
| `bun test` | PASS — 4 passed, 0 failed |
| `bun run test:harness` | PASS — 53 passed, 0 failed, 0 missing |
| local runtime-gates equivalent | PASS |
| GitHub `runtime-gates` | BLOCKED before checkout — GitHub Actions reports failed account payments or an insufficient spending limit; no runner or workflow step started |
| corrected FR231 dry run | PASS — READY=93, CANONICAL=87, INVALID=0, OVERALLOCATED_INSTRUCTORS=0 |
| missing assigned-hours dry run | PASS — 4 BLOCKED, safe READY=89, safe CANONICAL=83 |

## PRODUCTION_ACTIONS_REQUIRED

No application-production action is required. No production write, import, migration apply,
Lovable publish, Excel rewrite, or PR merge was performed.

After normal release approval, users may provide one of the supported optional assigned
hours columns while keeping the FR231 component total at 2.

Repository administration must restore GitHub Actions billing/spending availability and
rerun PR #115. The PR must remain Draft until `runtime-gates` is green.

## FINAL_DECISION

`HOLD_WITH_ONE_EXACT_ASSIGNED_HOURS_SEPARATION_BLOCKER`

Exact blocker: `B-CI-GITHUB-ACTIONS-BILLING-NO-RUNNER` — the required GitHub
`runtime-gates` check cannot start because the account payment/spending gate rejects the
job before checkout. Local runtime-gates-equivalent validation is fully green, but the
mission explicitly requires green CI before Ready.
