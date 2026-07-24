# PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-SOURCE-01

## Decision

`PASS_PLAN_COMPONENT_ROOM_TYPE_ATOMIC_PERSISTENCE_RPC_SOURCE_PR_READY`

This is a source-only result. No SQL was applied, no Supabase environment was
contacted, no data was changed, and no deployment was performed.

## Baseline and branch alignment

- Repository: `msorori-mh/usrtimetable`
- Draft PR: `#87`
- Branch: `fix/plan-course-component-room-type-normalization-source-01`
- Requested starting point: `6f4c884`
- Baseline: `origin/main` at `97fd3d9`
- Alignment method: merge commit `7328db6`. A rebase would require rewriting the
  already-published branch and therefore a forbidden force push.

## Existing persistence contract

The current public commit contract is:

```sql
public.commit_import_job_atomic(
  p_job_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
```

It was introduced by
`supabase/migrations/20260718210000_source_only_atomic_import_job_commit.sql`.
It is `SECURITY DEFINER`, fixes `search_path` to `public, pg_temp`, derives the
actor through `import_manager_actor(college_id)` / `can_manage_college`, locks
the import job, checks the creator, manifest and replay state, and is executable
by `authenticated` and `service_role`.

Both `study_plan_courses` and `full_study_plan` are dispatched to
`_import_apply_study_plan`, which invokes
`_import_sync_plan_course_components`. That helper upserts on
`(plan_course_id, component_type)` but does not insert or update
`required_room_type_id`. There is no later trigger that repairs this omission.
The import is incremental and does not delete plan courses outside the batch.

## New atomic V2 contract

The forward-only draft defines:

```sql
public.commit_plan_component_import_job_atomic_v2(
  p_job_id uuid,
  p_expected_updated_at timestamptz DEFAULT NULL
) RETURNS jsonb
```

The draft preserves the historical implementation under a private legacy name,
revokes client access to it, and makes the old public signature reject both plan
targets with:

`ATOMIC_PLAN_COMPONENT_PERSISTENCE_RPC_UNAVAILABLE`

Non-plan imports retain their existing behavior. Thus no parallel plan path can
persist components with a missing room UUID.

### Authorization and isolation

- Requires `auth.uid()`.
- Locks the import job and requires `preview` state.
- Uses the current `import_manager_actor` authorization contract and requires
  the actor to be the job creator.
- Derives the college from the program/plan relationship and verifies it equals
  the server-owned job college; it accepts no client-provided college.
- Rejects anonymous, read-only, unassigned, cross-college, or mismatched actors.
- Is `SECURITY DEFINER` with fixed `search_path`, owned by `postgres`, revoked
  from `PUBLIC` and `anon`, and granted only to `authenticated` and
  `service_role`.

### Transaction and concurrency

The V2 function validates every payload row before operational DML, acquires a
deterministic transaction advisory lock for the plan natural key, locks existing
plan and plan-course rows, and calls the historical plan writer inside the same
top-level RPC transaction. It then upserts the full component contract,
including `required_room_type_id`, and writes the V2 audit result. Any exception
rolls back plan courses, components, job state, counts, timestamps, and audit
rows together.

The natural component key remains:

`plan_course_id + component_type`

Replaying a committed V2 job returns the stored result with
`idempotent_replay=true`. Legal later imports update the room UUID. The
historical incremental/skip behavior remains unchanged and rows outside the
batch are not deleted or disabled.

### Server room-type validation

For positive, timetabled theory, practical, tutorial, and project components,
the RPC requires a UUID and rechecks existence, same-college ownership,
`is_active=true`, and `default_capacity > 0`. It rejects malformed component
types, duplicates, negative hours, and scheduled summer training with the
specified stable codes:

- `ROOM_TYPE_REQUIRED_ATOMIC`
- `ROOM_TYPE_NOT_FOUND_ATOMIC`
- `ROOM_TYPE_WRONG_COLLEGE_ATOMIC`
- `ROOM_TYPE_INACTIVE_ATOMIC`
- `ROOM_TYPE_ZERO_CAPACITY_ATOMIC`
- `ROOM_TYPE_COMPONENT_CONTRACT_INVALID`
- `SUMMER_TRAINING_ROOM_POLICY_REQUIRED`

Summer training remains non-timetabled and room-free, matching the established
source policy. Zero-hour components do not require a room.

Before success the RPC proves:

```text
expected_required_room_components
=
persisted_components_with_required_room_type_id
```

Otherwise it raises `ATOMIC_ROOM_TYPE_PERSISTENCE_COUNT_MISMATCH`, causing a
full rollback.

## Caller cutover

- Both plan entities are mapped to the same V2 RPC.
- The validated payload includes explicit `component_type`, legal `hours`, the
  existing component flags, and the resolved `required_room_type_id`.
- The commit client makes one RPC call for the full plan batch.
- It performs no direct component insert/upsert and has no fallback to the old
  plan RPC.
- Missing RPC / PostgREST schema-cache errors map to
  `ATOMIC_PLAN_COMPONENT_PERSISTENCE_RPC_UNAVAILABLE`.
- The client independently rejects malformed or unequal expected/persisted
  counts before returning success.
- Generated Supabase function types and structured result counts were updated.

## Draft lifecycle artifacts

- Forward draft:
  `docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01.sql`
- Read-only preflight:
  `docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01-PREFLIGHT.sql`
- Post-verifier:
  `docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01-POST-VERIFIER.sql`
- Safe-disable-by-forward:
  `docs/migration-drafts/PLAN-COURSE-COMPONENT-ROOM-TYPE-ATOMIC-PERSISTENCE-RPC-01-SAFE-DISABLE.sql`

Safe-disable only revokes V2 execution. The old public plan route remains
fail-closed, and no plan, component, or audit data is deleted.

## Verification

| Check | `origin/main` | PR #87 | Delta |
| --- | ---: | ---: | --- |
| PostgreSQL 17 atomic harness | N/A | PASS | New source proof |
| Targeted atomic TypeScript harness | N/A | PASS | New source proof |
| Prior normalization harness | N/A | PASS | No regression |
| TypeScript | PASS | PASS | 0 new failures |
| Production build | PASS | PASS | 0 new failures |
| Scoped ESLint | vacuous | PASS | 0 new failures |
| `git diff --check` | PASS | PASS | 0 new failures |
| Static harnesses passed | 39 | 40 | +1 |
| Static harness failures | 2 | 2 | 0 new failures |
| Missing historical artifacts | 2 | 2 | unchanged |
| GitHub Actions `runtime-gates` | baseline suite fails | FAIL (shared suite only) | 0 new failures |

The shared baseline failures are:

- `course-offering-dependency-fk.harness.ts`: historical UI text assertion
  `UI counts TA`.
- `delivery-groups-workload-engine.harness.ts`: historical UI text assertion
  `generate button label`.

The shared missing historical files are:

- `implementation-reports/phase-6-reset-hardening-self-verifying-migrations-01/post-apply-verification.sql`
- `supabase/migrations/20260717043000_teaching_assignments_v2_runtime_foundation.sql`

Both GitHub Actions runs for commit `d750dff` completed the full workflow.
Checkout, frozen install, `git diff --check`, scoped ESLint, TypeScript, and
production build passed. The final harness step reported exactly `40 passed, 2
failed, 2 missing historical artifacts`; the two failures and two missing files
are the same clean-baseline findings above. No phase-owned or newly introduced
check failed. The unrelated baseline artifacts were deliberately not repaired
or masked in this phase.

The PostgreSQL 17 harness covers legal theory/practical/tutorial/project
persistence, multi-course batch, replay, legal UUID update, correct actor,
summer exemption, every required negative room/authorization/component case,
last-row failure rollback, lock/unique concurrency contracts, and forced count
mismatch rollback. It runs only in a disposable local Docker PostgreSQL 17
container.

## Assumptions, risks, and excluded work

- The forward draft assumes the historical atomic migration is already present
  before a future authorized apply; preflight checks that dependency.
- The V2 wrapper temporarily invokes the historical helper inside the same
  uncommitted transaction, then completes the room UUID upsert. No intermediate
  state is externally visible, and the final invariant rolls the entire
  transaction back on mismatch.
- Migration application still requires a separate authorized review and apply
  phase.
- Remediation/backfill of the 68 existing components was not performed.
- Mapping the 26 ambiguous records remains an owner decision outside this
  phase.
- No production data, environment, secrets, deployment, or publish action was
  touched.
