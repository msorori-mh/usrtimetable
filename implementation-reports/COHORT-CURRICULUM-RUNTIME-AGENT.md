# Cohort Curriculum Runtime Agent

## Outcome

The authenticated academic-cohort route now exposes an explicit cohort-first runtime action for
`generate_cohort_curriculum`. The application service accepts only a cohort identifier, parses the
RPC result fail-closed, and rejects any response claiming operational section, delivery-group, or
session creation.

The UI reports created/existing offerings and makes unapproved elective slots visible as skipped.
The new path does not read free individual registration or `course_offering_sections`. Existing
section-based behavior elsewhere remains explicit Legacy compatibility and was not changed.

Regular/parallel isolation remains owned by the authoritative RPC's cohort study-system predicates;
the client supplies no study-system override and therefore cannot merge those paths.

## Verification commands

- `node --experimental-strip-types tests/harness/cohort-curriculum-runtime.harness.ts` (PASS)
- `npx tsc --noEmit`
- `npm run build`
- scoped ESLint over the owned runtime route/service/hook/test files
- ownership and diff checks against `origin/main`

`git diff --check` passed. The standard `npx tsx` focused-harness invocation, TypeScript, build,
scoped lint, and Prettier commands could not start because this clean worktree has no
`node_modules`, Bun is unavailable, and npm is configured cache-only without cached packages. The
focused harness passed through Node's built-in TypeScript stripping. No dependency or lockfile
change was made to work around the environment restriction.

## Ownership

No Excel import, lifecycle, conflict reporting, central documentation/registry, generated types, or
migration file was edited. The shared `tests/harness/run.mjs` is outside this agent's focused
ownership, so the harness remains directly runnable.

`OWNERSHIP_CONFLICT`: wiring the focused harness into the shared central harness registry was
intentionally not performed.
