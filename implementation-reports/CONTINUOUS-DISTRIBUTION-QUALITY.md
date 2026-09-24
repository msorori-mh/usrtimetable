# Continuous distribution quality

Baseline: main `2fc2cd83fec20e73fc78f85874b7bfccbf06d0c1`.

## Problem

The compaction worker routed existing drafts through a feasibility/day-cap search. An unchanged feasible witness yielded zero moves, while stricter three-day search could also discard useful four-day gap improvements. Acceptance metrics did not include automatic hour-based instructor targets, exact one-lecture days, or practical lab fallback. The compaction mathematical objective charged lab fallback only in its generation objective.

## Implementation

The existing-draft worker now uses a dedicated anytime quality search: same-time lab recovery, repeated legal single moves, simultaneous two-session swaps, then bounded instructor/neighbor mathematical re-optimization. All remaining sessions stay fixed during a neighborhood solve. Seed the current feasible witness, keep searching after feasibility, and preserve the best validated plan on timeout. Budget is reserved for both swaps and larger neighborhoods. Accepted exchanges re-check practical sessions for newly freed labs.

Measure automatic instructor target excess (6/10/16-hour thresholds), exact one-lecture days and practical hall fallback. Add lab fallback and teacher singleton costs to the mathematical compaction objective. Preserve the existing generation path and its hard constraints.

Quality proposals cannot increase days for any individual instructor, student partition or level. Acceptance protects student/instructor gap totals and worst gaps, student short days, saved explicit targets and room preference. Independent full validation preserves session identity, hours, locks, rooms/capacity, availability, external busy time, student daily policy and attendance ceilings. Existing invalid drafts are diagnosed, not silently certified. No constraint is edited or relaxed.

Save quality plans through the existing all-or-nothing `apply_schedule_relayout` RPC with original fingerprints/revision/timestamps. Recheck the complete final plan and quality at save time. A quality marker cannot select the sequential path. Existing protected receipt/retry/unknown-outcome handling is unchanged.

UI shows before/after metrics and explicit time limit, candidate limit, locked, invalid-baseline, empty and bounded-neighborhood results. Zero moves is not presented as optimality. Extended-day explanatory text uses the stored setting instead of hardcoding one day.

## Evidence

Focused tests reproduce three two-hour lectures consolidated to one day, improvement within four locked student days, same-time hall-to-lab moves, capacity/lock protections, swaps with no temporary vacancy, no per-person day increases, cancellation/timeouts, and cross-college busy time. Actual worker routing/progress and atomic service routing/rejection are covered.

Local combined regression: 90 tests passed (quality, mathematical model, generation relocation, service, worker client, real V2 orchestration, daily policy). Focused TypeScript check passed. Full CI is a required merge gate.

Read-only production snapshot replay (275 sessions, 54 instructors) found a valid 53-session change plan in 45 seconds before the final same-time lab recheck refinement: student average gap 99.55 to 65.92 minutes; instructor average gap 60 to 45.56; one-lecture days 91 to 84; practical hall sessions 9 to 1; total instructor days 173 to 170. Sessions remained 275 and teaching minutes 37,560. This is a local candidate, not a production application or optimality proof. Raw snapshot/proposals are not committed.

## Security and rollout

No SQL migration, RPC definition, RLS, role, authentication or authorization change. No secrets or personal snapshot data in the change. Existing authenticated read and guarded atomic write surfaces remain. No production schedule was changed. Code rollout and actual timetable application are separate; the user can preview and apply to the existing draft without regenerating it.

Remaining limits: bounded heuristic/MIP neighborhoods cannot prove global optimality, and some fragmented attendance or hall fallback can remain. A browser end-to-end run with the real authenticated draft has not been performed; CI, source integration tests and local replay are the evidence. No Lovable AI chat was used.
