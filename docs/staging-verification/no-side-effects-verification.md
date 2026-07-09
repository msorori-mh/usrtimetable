# G12 — No-Side-Effects Final Comparison

Values compared before and after VERIFY-01:

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| `schedule_version_conflict_exceptions` rows for target | 44 | 44 | **0** |
| `schedule_versions` status (target) | `draft` | `draft` | **unchanged** |
| `schedule_sessions` for target | 198 | 198 | **0** |
| Published versions (any) | 0 | 0 | **0** |
| `schedule_quality_runs` for target | 0 | 0 | **0** |
| `schedule_version_events` for target | 0 | 0 | **0** |
| Rooms / instructors / teaching_assignments | unchanged | unchanged | **0** |
| `supabase_migrations.schema_migrations` records | 4 EXEC-01 chunks | same 4 | **0** |

All queries in this phase were `SELECT`-only (Python `psycopg2` harness with
role `sandbox_exec` which only holds `SELECT`+`INSERT` on the exceptions
table — no INSERT was performed during VERIFY-01).

**Total DB writes during VERIFY-01: 0.**

Result: **PASS**.
