# G2 — Security & Permission Verification

## Policy audit
Only three policies exist on `public.schedule_version_conflict_exceptions`
(see G1). All three predicates route through
`can_view_college(auth.uid(), college_id)` or
`can_manage_college(auth.uid(), college_id)` — both are `SECURITY DEFINER`
helpers that require either `super_admin` or an active `user_colleges`
membership plus (`can_manage`) `college_admin` role.

- No policy uses `USING (true)` ✅
- No policy uses `WITH CHECK (true)` ✅
- No `DELETE` policy — revocation must go through the `UPDATE` policy which is
  restricted to `college_admin`/`super_admin`.
- `anon` has no explicit grants; `authenticated` has none broader than the
  policies allow (verified via `information_schema.role_table_grants`).

## RLS state
- `relrowsecurity = true` ✅
- `relforcerowsecurity = false` (intentional; the table owner and service_role
  bypass RLS as designed for maintenance jobs).

## Integrity trigger `ensure_svce_session_version_integrity`
Behaviour observed in DDL and validated by EXEC-01 rejection tests
(re-used here as canonical evidence — no new writes performed):

| Rule | Behaviour | EXEC-01 test |
| --- | --- | --- |
| `session.schedule_version_id == exception.schedule_version_id` | raises `session/schedule_version mismatch` | cross-version session → **rejected** |
| `related_session.schedule_version_id == exception.schedule_version_id` | raises `related_session/schedule_version mismatch` | cross-version related → **rejected** |
| `related_session_id != session_id` | raises `related_session_id must differ from session_id` | same-session pair → **rejected** |
| college alignment (session + related + version) | raises `*/college mismatch` | college mismatch → **rejected** |
| single-session exception (`related_session_id IS NULL`) | allowed | 2 room_type rows present ✅ |
| duplicate normalized pair | blocked by `uq_svce_active_pair` | duplicate pair → **rejected** |

## Cross-version / cross-college bypass
Impossible under the constraints above. Leaked rows in EXEC-01 sweep: **0**.

## Revoked rows
`buildApprovedExceptionIndex` in `src/lib/conflict-engine/exceptions.ts` skips
rows with `status <> 'approved'`. Backend `loadApprovedExceptions` filters
with `.eq('status', 'approved')`. Current Staging state: 44 rows, all
`approved`, 0 revoked — so no revoked-bypass risk realized.

Result: **PASS** — no permission escalation surface, no bypass paths.
