# ITCS practical labs — execution evidence (2026-09-26)

- Approved split: 55 → 28 + 27; 60 → 30 + 30.
- Third practical group: 42 students moved to Computer Lab 2 at its existing Wednesday 12:00–14:00 time.
- Two additional draft sessions created; four existing draft sessions moved to release valid lab slots.
- Yasser Al-Samai: 17 hours, 8 sessions, 4 days (within the hard cap of 4; previous preference was 3). All nine affected/new session placements fit individual instructor and room availability.
- Draft: 281 sessions / 642 hours → **283 sessions / 646 hours**.
- Published V2: **275 sessions / 627 hours**, all five stored published-session digests still match.
- Five target sessions: expected 28, 27, 42, 30, 30; each room is a 42-seat computer lab, and the cloned teaching assignment requires `computer_lab`.
- Version group derivation: all five draft groups `CURRENT`, and the three corresponding published groups remain `CURRENT` at 55, 42, 60 students and capacity 75.
- Full draft room pair clashes: 0; instructor pair clashes: 0; distinct student partition clashes: 0; room-type mismatches: 0; over-capacity sessions: 0.
- Transaction rehearsal passed with `ROLLBACK` after forcing deferred constraints immediately. Live transaction passed the same postconditions and committed.
- The last stored quality run precedes the split (51 soft, 0 hard, score 0). A fresh read-only calculation from current sessions gives 36 workload-balance flags, 16 instructor gaps, and one day-distribution flag: 53 soft findings, 413 deduction points, score 0. This score is saturated by global workload-balance penalties and should not be treated as publication readiness evidence without refining the metric. No new quality run was persisted.
- The analytics false-positive fix is separately awaiting review in PR #317. This operations PR records the applied SQL and evidence; merging it is repository bookkeeping and does not reapply the one-shot transaction.
