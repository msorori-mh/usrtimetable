# G3 — Seed Data Independent Verification

Counts recomputed live from `public.schedule_version_conflict_exceptions`
scoped to schedule version `482af19b-…`:

| Metric | Expected | Observed |
| --- | --- | --- |
| Total rows | 44 | **44** ✅ |
| Pair rows (`related_session_id IS NOT NULL`) | 42 | **42** ✅ |
| Single-session rows (`related_session_id IS NULL`) | 2 | **2** ✅ |
| `instructor_conflict` | 22 | **22** ✅ |
| `room_conflict` | 20 | **20** ✅ |
| `room_type_mismatch` | 2 | **2** ✅ |
| `status = 'approved'` | 44 | **44** ✅ |
| `status = 'revoked'` | 0 | **0** ✅ |
| Rows for other schedule versions | 0 | **0** ✅ |
| Cross-college rows | 0 | **0** ✅ |
| Orphan `session_id` refs | 0 | **0** ✅ |
| Orphan `related_session_id` refs | 0 | **0** ✅ |
| Same-session pair rows | 0 | **0** ✅ |
| Duplicate normalized pairs | 0 (enforced by `uq_svce_active_pair`) | **0** ✅ |

All 44 rows' `session_id` and `related_session_id` (when present) belong to
schedule version `482af19b-…`.

Result: **PASS**.
