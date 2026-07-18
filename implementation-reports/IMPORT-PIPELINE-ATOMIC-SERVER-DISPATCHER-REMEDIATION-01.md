# IMPORT-PIPELINE-ATOMIC-SERVER-DISPATCHER-REMEDIATION-01

Date: 2026-07-18 (Asia/Riyadh)

## Decision

**PASS_WITH_NOTES — IMPORT_PIPELINE_ATOMIC_REMEDIATION_PR_45_UPDATED**

HIGH `HIGH_DOMAIN_DML_NOT_ATOMIC_PR_45_ARCHITECTURAL_BATCH_RPC_REQUIRED` is closed in source: production import commit now invokes a single server-side atomic RPC. Notes: scoped ESLint reports repository CRLF/Prettier baseline noise (not treated as a blocker); one unrelated full-suite harness (`course-offering-dependency-fk`) remains red against current `course-offerings.tsx` (pre-existing vs this change).

## Identity

| Item | Value |
|---|---|
| Repository | msorori-mh/usrtimetable |
| Branch | `codex/import-pipeline-safety-agent` |
| PR | https://github.com/msorori-mh/usrtimetable/pull/45 (Draft, not merged) |
| Old PR head | `e082cd553cd0ba2fbccdce09629e2a7d545f5448` |
| New PR head | `0c3577f460bc06bbdd5287dd14a88d313deaf7b6` |
| origin/main used | `b0147349934a1fa217e6c3eaf972bbcc03733ff7` (merged via `--no-ff`) |

## Implementation

### Migration (SOURCE-ONLY / NOT APPLIED)

- Path: `supabase/migrations/20260718210000_source_only_atomic_import_job_commit.sql`
- Public RPC: `public.commit_import_job_atomic(p_job_id uuid, p_expected_updated_at timestamptz DEFAULT NULL) RETURNS jsonb`
- Internal `_import_*` / `_import_apply_*` helpers: EXECUTE revoked from PUBLIC/anon/authenticated
- Public RPC: EXECUTE granted to `authenticated` (+ `service_role`); revoked from PUBLIC/anon
- No backfill, no invocation, no seed, no historical migration edits, no DROP/TRUNCATE

### Client

- `src/lib/excel-import/commit.ts` — commit path sends `job_id` + optional `expectedUpdatedAt` only; calls `commit_import_job_atomic`; no insert/update/upsert/delete on domain tables; no client dispatcher fallback
- `src/routes/_authenticated/import.tsx` — UI uses the slim commit API and refreshes jobs after success
- Preview remains client-assisted; stored validated payload on the server is authoritative at commit

### Contract coverage

- Auth via `auth.uid` + `import_manager_actor` / `can_manage_college`
- Job `FOR UPDATE`; actor must match `created_by`; college/entity/mode from job only
- Manifest integrity; stale concurrency token (`40001`)
- Pre-validate before DML; deterministic `ORDER BY id ASC` locks; full rollback on any error
- Success audit `import_job_committed` in the same transaction
- Idempotent replay when status already `committed` (no re-write)
- Legacy + V2 handlers (V2 delegates to existing `commit_teaching_assignments_v2_import`)

## Verification

| Gate | Result |
|---|---|
| Focused import harnesses | PASS |
| Disposable PostgreSQL 15 proof | PASS (compilation, auth negatives, substitution, isolation, success, audit, replay, forced rollback, concurrent idempotency); container removed |
| TypeScript (`tsc --noEmit`) | PASS |
| Production build | PASS |
| Scoped ESLint | NOTES — CRLF/Prettier baseline noise only |
| `git diff --check` | PASS |
| Migration apply / production DB writes | NONE |
| Deploy / publish | NONE |

### Disposable proof coverage exercised

1. authorized atomic rooms commit  
2. unauthenticated reject  
3. read_only reject  
4. cross-college reject  
5. actor substitution reject  
6. payload substitution reject  
7. regular/parallel section isolation  
8. cohort study_system isolation  
9–17. stored payload, pre-validation, forced rollback, zero success-audit on rollback, success audit, replay, concurrent/idempotent replay, lock ordering, server counters  
18–21. no client operational DML (static), no partial success, legacy handlers compiled, no migration backfill/invocation  

## Constraints honored

- No Production DB writes  
- No Migration apply / db push / reset / repair / seed  
- No real data import  
- No Deploy or Publish  
- No force-push  
- No mainline edit  
- PR #45 left Draft and unmerged  
- Migration remains NOT APPLIED  

## Next phase

**PR #45 INDEPENDENT REREVIEW**
