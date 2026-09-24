# Atomic generation and bounded rearrangement

Baseline: `252d7d7d348a0ddbd6233b22617f176337d8249e`.

Implementation complete; production activation is **HOLD** until the additive migration is applied and deployment is verified. No production timetable, assignment, group, capacity or constraint has been edited by this change.

## Behavior

- V2 solves existing and missing sessions together. Actual locks and sessions outside a selected study-system scope remain fixed. The model and independent validator limit existing-session relocations to 32 per joint plan.
- Instructor day indicators are linked to placements and summed under the effective hard ceiling: four by default, retaining recorded target/max exceptions. The same policy is checked in candidate search, final validation, SQL before commit and readback.
- Generation retains hour-based attendance targets (6/10/16 hours -> 1/2/3 days, otherwise 4), explicit targets and penalties for excess days. Weekly demand counts existing and missing sessions once. Cheap movement and room-fallback costs remain; expensive span optimization stays in compaction.
- The complete witness is applied through `apply_schedule_generation`. Rejected constraint placements can continue through direct alternatives and bounded repair: at most two unlocked relocations, 4,000 feasibility evaluations and eight distinct save plans per missing unit. All paths use complete-plan validation and the same atomic RPC.
- Whole-plan success skips repeated domain enumeration. Reports reflect practical-room fallback, successful relocations, attempts and completion readback.
- Unknown transport outcomes stop the run with an operation ID; they never cause compensating moves or another blind write. The existing protected `get_schedule_compaction_result` receipt endpoint can confirm the outcome. A fresh run reconciles persisted sessions against the required cadence.

## Transaction and security review

New RPC: `apply_schedule_generation`; migration: `20260918020000_atomic_schedule_generation.sql`.

The RPC authenticates `auth.uid()`, checks `can_manage_college`, locks the scoped draft/version and assignment rows, checks revision and timestamps, and limits the request to 32 relocations / 512 additions / 1 MiB. It delegates moves and identity-derived inserts to the existing guarded RPCs without disabling triggers or bypassing their checks. Final instructor, student and extended-day caps run before commit. A rejection rolls back moves, additions, revisions, audits and nested receipts. Successful retries return the actor/scoped, request-hash-bound receipt.

- RLS/policies: unchanged.
- Authentication and authorization semantics: unchanged; the additive RPC requires the same manager authority.
- RPC ACL: authenticated only; no PUBLIC, anon or service_role grant on the new entry point.
- Search path: empty and all application objects schema-qualified. No dynamic SQL or caller-supplied identity writes.
- Sensitive data: no secrets, raw SQL errors or foreign-tenant rows returned.
- Privilege escalation: none identified in reviewed changes; reader, anonymous and foreign-college rejection exercised.
- Production risk: medium, because generation orchestration and transactional persistence change together.

## Evidence

Local tests:

- 57 Node tests: joint solver, student daily policy and real V2 orchestration with mocked I/O boundaries. Includes first-run relocation, actual bounded fallback, locks, hard caps, explicit exceptions, cancellation, staleness, practical rooms and unknown responses.
- 31 Bun tests: repair search and instructor target/max policy.
- Seven SQL scenarios run in isolated PostgreSQL/WASM using the repository's actual guarded relayout/create functions and fixture schema: atomic success; rollback after the second insert fails; RBAC; locked session; receipt retry/stale revision; instructor cap/exception; cross-tenant IDs.
- TypeScript check passed for the materialized scheduling source and its dependency closure (`tsc --noEmit -p tsconfig.json --types vite/client,node`). This local workspace is not a complete frontend checkout; this is not a claim of a full Vite build.
- Added `Atomic generation regression` CI for the same model/orchestration tests plus the SQL suite on native PostgreSQL 16. CI results must be checked on the final PR head.

The old sequential rollback tests were replaced by atomic-application tests. The old expectation that generation freezes every existing placement was replaced with actual-lock preservation and end-to-end relocation assertions. The former partial-write expectation for an impossible five-day instructor plan now requires rejection before the first write.

## Activation and rollback

1. Confirm the production baseline has the current guarded relayout/create functions, attendance columns and receipt infrastructure. Confirm no active generation on the draft chosen for post-verification.
2. Apply the additive migration through the authorized database migration channel, then verify the function signature and authenticated-only ACL. The migration creates no sessions and changes no RLS policy.
3. Deploy the matching application commit only after the RPC exists. Missing RPC causes generation to stop; there is deliberately no unsafe sequential fallback.
4. On a disposable/staging draft, verify a relocation-required case and failure rollback, then inspect receipt, instructor days, locked placements, required/placed counts and conflicts. Validate a representative large workload and concurrent editors before declaring production readiness.

Rollback order: restore the previous application version first; the unused additive RPC may remain. Do not delete sessions or receipts to roll back code. Reverting a successful generated timetable is a separate authorized operation, not part of this migration.

Limits: bounded search can still report an unsolved or infeasible draft. These changes do not guarantee every set of real constraints has a solution. Live performance, concurrent-editor behavior and production deployment have not been claimed as verified.
