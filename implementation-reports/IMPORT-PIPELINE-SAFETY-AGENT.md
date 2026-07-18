# Import pipeline safety agent report

## Scope and outcome

Hardened the source-only Excel preview/validate/commit path within the assigned ownership boundary.

- Preview and commit now require an authenticated super administrator or a college administrator assigned to the target college.
- Preview job creation rejects caller-supplied actor spoofing.
- Preview persists the canonical validated JSONB payload and a server-derived manifest in the same transaction as validation errors and its audit record.
- Commit binds actor, college, entity, mode, and the complete payload (not merely its row count), then consumes the server-stored payload returned by a serialized compare-and-set claim.
- Same-count substitution, cross-college access, actor substitution, and replay are rejected by `SECURITY DEFINER` RPC checks.
- Claim, finalize, failure recovery, error persistence, counters, and their audit records are server-observable and atomic within each RPC.
- Import errors are no longer silently discarded, and any row failure produces a failed job status instead of a misleading committed status.
- Section keys and database matching now include `study_system` (defaulting legacy rows to `regular`) so regular and parallel sections cannot collide.
- Teaching-assignment V2 logical identity remains cohort- and delivery-group-specific through a shared normalized key helper.
- Direct-ID updates/deletes touched by this change received explicit college predicates where the table carries `college_id`.

## Transaction boundary

`teaching_assignments_v2` already commits through its gated atomic RPC. The new migration makes every import-job state transition and audit/error write atomic and provides a guarded `committing -> failed` recovery path.

The remaining custom handlers still perform their domain-row writes through multiple client requests. Consequently, an unexpected failure after one successful domain write can leave partial domain data even though the job is durably marked failed. True all-or-zero domain rollback requires moving every entity-specific import handler into a single SQL batch dispatcher; that larger rewrite is not represented as solved here.

## Validation

- Added a disposable PostgreSQL fixture covering positive claim/finalize, cross-tenant rejection, same-count substitution, replay, recovery, atomic audit, and forced-audit rollback.
- PASS: Node syntax checks for the changed import TypeScript modules.
- PASS: `git diff --check`
- BLOCKED (environment): full TypeScript, scoped ESLint, Vite build, and PostgreSQL fixture execution. The clean worktree has no `node_modules` and no disposable migrated database was supplied.

No database writes, migration apply, deployment, publication, or data import were performed during validation.
