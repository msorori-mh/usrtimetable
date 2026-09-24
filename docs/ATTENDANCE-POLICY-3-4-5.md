# Certified attendance-day policy

Target: at most three attendance days per program/level/study-system/term. Four days require a completed infeasibility proof for three; five require proofs for both three and four. A timeout, cancellation, missing partition map or unorderable move plan never authorizes relaxation.

## Implementation

- A fast approved-grid pass first looks for a witness. Its grid exhaustion cannot certify infeasibility; inconclusive results fall through to minute-domain search within the remaining time. Capacity bounds use a superset of all template days, never the smaller grid domain.
- `attendance-search.ts`: bounded exhaustive finite-domain search over every minute in active templates and compatible rooms. All unlocked sessions are movable; locks, assignments and durations are fixed. Capacity bounds or full domain exhaustion establish infeasibility. Budget exhaustion returns UNKNOWN with no writable proposal.
- A six-hour student daily cap makes eight two-hour sessions fit as 3–3–2. Candidate ordering prefers contiguous student days and teacher adjacency across programs. This is a feasibility certificate for the day cap, not a proof that secondary gap metrics are globally optimal.
- `attendance-compaction.ts`: converts a simultaneous witness into legal ordered moves, including a free temporary buffer for swaps where available. The existing authorized atomic RPC remains authoritative; no sequential database fallback is introduced.
- The preview worker uses the certified search. The panel displays each attempted cap, result and proof scope.
- V2 generation plans the whole remaining workload before the first session creation, then writes only the witnessed placements. It records the day cap and prior infeasibility attempts in the run summary and creation notes. A rejected placement stops further generation; no heuristic repair can silently escape the certified plan.
- Fill-missing preserves its existing-session contract: a witness requiring relocation directs the operator to compaction rather than silently changing existing sessions or relaxing the cap.

## Evidence and limits

58 focused Node tests pass, including real V2 orchestration for three, four and five days, 3–3–2/no-gap distribution, cancellation, budgets, incomplete membership, off-grid minute availability, locks, shared resources and legal buffered swaps. TypeScript and local production build pass. CI adds the new suite to the existing scheduling gate.

The certificate is scoped to the supplied version, memberships, fixed assignments, durations, locks and current local feasibility model. Server-only constraints remain authoritative at save time: a server rejection requires a fresh plan and is never evidence for relaxation. Search is bounded (60 seconds for generation, selectable preview budget; one million candidate evaluations); large instances can remain UNKNOWN. A supported-input size guard also returns UNKNOWN, never UNSAT. Ordered saving remains bounded by the existing 512-move transaction limit.

No migrations, RPC signatures, RLS, authentication or authorization changed. Existing revision checks, per-move validation, atomic rollback and protected receipts remain in place. No production schedule data was changed by development or tests.

Rollback: revert this feature commit; existing saved session schema is unchanged.
