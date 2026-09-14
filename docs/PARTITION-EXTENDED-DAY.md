# One extended day per actual student group

When enabled for a college, every actual student partition may attend past the configured normal day end (14:00) on at most one weekday. Theory, practical, tutorials and projects count together. Parallel partitions may use different weekdays; a shared lecture consumes the day for all attending partitions. Ending exactly at 14:00 is normal.

The existing room availability, teaching hours, locks, capacity and overlap constraints remain authoritative. Opening lecture halls to 16:00 is permitted only together with this enabled policy. No sessions are deleted or shortened.

Generation and compaction use the same predicate. Capacity proofs include the limit: with 08:00–14:00 normal days and one extension to 16:00, three days can carry at most 20 hours and four days at most 26. A workload of 22 hours therefore rules out three days independently of solver timeout. Search timeout remains UNKNOWN and never authorizes another attendance day.

The additive database script `supabase/sql/partition_extended_day.sql` defaults the policy off. It uses invoker functions and existing RLS; it neither changes authentication nor grants write access. Session writes cannot increase existing per-partition extended-day violations; this allows a legacy draft to be repaired incrementally. Publication rejects any remaining violation. Incomplete mappings use a conservative cohort fallback and do not justify an infeasibility proof in the client solver.

Validation: `tests/extended-day.test.mjs` covers independent/shared partitions, room-independent counting, the 14:00 boundary, moving an existing extension, disabled policy, capacity and a four-day witness. `tests/extended-day-db.test.mjs` runs on an explicitly disposable PostgreSQL database and checks rejected writes, rollback, publication and RLS.

Rollout: deploy the additive SQL and tested client, enable the college policy, then extend its room availability to 16:00 in the same transaction. Re-read all scheduling inputs before preview and apply only through the existing authorized save flow. SQL activation does not redistribute existing sessions. Do not disable the policy to get a failed schedule accepted.
