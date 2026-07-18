# Import pipeline safety agent report

## Scope and outcome

Hardened the source-only Excel preview/validate/commit path within the assigned ownership boundary.

- Preview and commit now require an authenticated super administrator or a college administrator assigned to the target college.
- Preview job creation rejects caller-supplied actor spoofing.
- Commit binds the job to actor, college, entity, mode, valid-row count, and `preview` state, then claims it with a compare-and-set transition to prevent replay/double commit.
- Import errors are no longer silently discarded, and any row failure produces a failed job status instead of a misleading committed status.
- Section keys and database matching now include `study_system` (defaulting legacy rows to `regular`) so regular and parallel sections cannot collide.
- Teaching-assignment V2 logical identity remains cohort- and delivery-group-specific through a shared normalized key helper.
- Direct-ID updates/deletes touched by this change received explicit college predicates where the table carries `college_id`.

## Transaction boundary

`teaching_assignments_v2` already commits through its gated atomic RPC. The remaining custom import handlers perform multi-table client-side DML and cannot provide true all-or-zero rollback from source-only TypeScript.

`OWNERSHIP_CONFLICT`: an atomic batch RPC and its migration would be required to guarantee rollback for study plans, section groups, cohorts, electives, offerings, and legacy assignments. Migrations and unrelated services are outside this agent's ownership, so none were edited or applied.

## Validation

- PASS: `node --experimental-strip-types tests/harness/import-pipeline-safety.harness.ts`
- PASS: Node syntax checks for the changed import TypeScript modules.
- PASS: `git diff --check`
- BLOCKED (environment): full TypeScript, scoped ESLint, and Vite build. The clean worktree has no `node_modules`, Bun/Bunx are unavailable, and npm cannot fetch uncached packages in the restricted environment.

No database writes, migration apply, deployment, publication, or data import were performed during validation.
