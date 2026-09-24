# USR-TIMETABLE-SIMPLIFIED-TEST-ONLY-ACCEPTANCE-PACK-03

## Decision

`PASS_LOCAL_FIXTURES / BLOCKED_LOVABLE_CLOUD_APPLY`

## Scope

- Environment: local source only.
- Branch: `agent/test-only-acceptance-pack-03`.
- Target: deterministic acceptance data for `super_admin`, `college_admin`, and `read_only`.
- Out of scope: Lovable Cloud writes, Auth user creation, migrations, deployment, and production cleanup.

## Fixture contract

- Every object carries marker `TEST_ONLY_USRTIMETABLE_SIMPLIFIED_03`.
- All account emails use the non-deliverable `.invalid` domain.
- All IDs are deterministic, unique UUIDs reserved for this pack.
- Non-super roles are restricted to one synthetic college.
- The schedule version is `draft` and `disposableTest=true`.
- Cleanup targets enumerate exact IDs; there is no wildcard or marker-less delete.
- No password, service-role key, database client, SQL mutation, or network call exists in the fixture.

## Acceptance path

1. Select the academic context.
2. Review the weekly grid.
3. Open unscheduled work.
4. Apply the change locally.
5. Validate conflicts.
6. Save the validated change.

## Role expectations

- `super_admin`: manage users and all colleges; edit, validate, and save.
- `college_admin`: edit, validate, and save only in the assigned test college; cannot manage users.
- `read_only`: view assigned-college data; no mutation capability.

## Cloud blocker

The Lovable plugin was selected and its connection was reported by the user, but no Lovable
read/write action was exposed to the active tool session. Therefore no cloud user or row was
created, modified, or deleted. Cloud application remains fail-closed until a callable Lovable
action is available and a read-only preflight proves the exact project and environment.

## Verification

- Prettier: PASS.
- `git diff --check`: PASS.
- Focused TEST_ONLY harness: 1/1 PASS.
- Repository harness suite: 64/64 PASS.
- TypeScript `--noEmit`: PASS.
- Scoped ESLint: PASS.
- Production build: PASS.
- Existing build notes only: deprecated TanStack `inputValidator()` calls and a large client chunk.
- Bun unit suite: not rerun because the sandbox image does not provide the Bun executable;
  the repository's Bun-native test imports cannot be substituted faithfully with Node.
