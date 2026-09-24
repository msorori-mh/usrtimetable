# G1 — Migration Installation Verification

## Registration
The canonical migration `20260709193500_schedule_version_conflict_exceptions.sql`
was applied on Staging as a set of four sequential migration records via the
Lovable Cloud migration tool during EXEC-01:

| Version | Filename |
| ------- | -------- |
| 20260709213405 | a7ddbff3-… (CREATE TABLE + constraints) |
| 20260709213525 | 62114af2-… (GRANT INSERT to sandbox_exec — Staging harness) |
| 20260709213902 | a070c634-… (Seed insert chunk 1) |
| 20260709213956 | 0a0f7761-… (Seed insert chunk 2) |

The **schema effect** matches the SHA-verified source (`b0528f29…`) reviewed in
LOVABLE-SYNC-CHECK-02; no duplicate table, no duplicate policy, no partial
obsolete function detected.

## Table `public.schedule_version_conflict_exceptions`
- Columns (15): `id, college_id, schedule_version_id, conflict_code, session_id,
  related_session_id, approval_type, reason, source, status, approved_by,
  approved_at, metadata, created_at, updated_at` — types and nullability match
  spec.
- PK: `schedule_version_conflict_exceptions_pkey`.
- FKs: `schedule_version_id → schedule_versions(id) ON DELETE CASCADE`,
  `session_id → schedule_sessions(id) ON DELETE CASCADE`,
  `related_session_id → schedule_sessions(id) ON DELETE CASCADE`.
- CHECK: `status IN ('approved','revoked')`;
  pair-distinct constraint `svce_session_pair_distinct` on `related != session`.
- Normalized-pair uniqueness enforced via unique index `uq_svce_active_pair`.
- Indexes (5): `_pkey`, `uq_svce_active_pair`, `idx_svce_version_code`,
  `idx_svce_college_version`, `idx_svce_session`.
- Triggers (2, non-internal):
  - `trg_svce_session_version_integrity` (BEFORE INSERT/UPDATE) →
    `ensure_svce_session_version_integrity()`.
  - `trg_svce_updated` (BEFORE UPDATE) → `set_updated_at()`.

## Function `ensure_svce_session_version_integrity`
- `SECURITY INVOKER` (`prosecdef = false`) ✅
- `search_path = public` ✅
- Enforces (from source in db-functions):
  session/version match, related session/version match, `related != session`,
  college alignment, single-session support (`related_session_id IS NULL` OK).

## RLS
- `relrowsecurity = true`, `relforcerowsecurity = false` (owner bypass OK) ✅
- Policies (3):
  - `svce_select` (SELECT): `USING can_view_college(auth.uid(), college_id)`
  - `svce_insert` (INSERT): `WITH CHECK can_manage_college(auth.uid(), college_id)`
  - `svce_update` (UPDATE): `USING`/`WITH CHECK can_manage_college(auth.uid(), college_id)`
- No DELETE policy (revocation is an UPDATE to `status='revoked'`).

## Grants
Only `sandbox_exec` (managed harness role) has explicit `SELECT/INSERT`. No
`anon`/`authenticated` blanket grants are recorded on the table — all client
access flows through RLS-protected role paths as designed.

Result: **PASS** — schema mirrors the reviewed migration source exactly, and
no duplicates or drift were detected.
