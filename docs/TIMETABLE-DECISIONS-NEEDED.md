# Timetable Decisions Needed

Only decisions that cannot safely be inferred belong here.

## User approval required

1. Any production migration/apply, database write, deploy, publish, or change of an actual schedule version to `published`.
2. Migration-history reconciliation and an approved one-migration apply sequence after the remote applied list can be obtained. Runtime remains closed meanwhile.
3. Production application of `20260718120000_source_only_atomic_schedule_version_lifecycle.sql` requires a separate explicit approval. Payload identity must be pinned to merge `a1862a8a5ff1a3a546d1e12e545c75c5d5a9dfb1` and the migration checksum captured immediately before execution. Preflight: reconcile remote migration history; verify required tables/columns/functions, authenticated grants/RLS, tenant references, backup/rollback window, and zero active publishing operations. Post-verification: catalog compilation, RPC authorization negatives, revision freshness, OLD/NEW and college/global invalidation, audit atomicity, published/archived immutability, and no unintended schedule-status transition. No apply has been performed.

## Resolved binding academic decision

- The approved study plan is authoritative for cohort core courses by level/semester; electives require an approved cohort-level academic selection.
- `academic_cohort` is the primary student context. `delivery_groups` exist only for capacity/delivery splits.
- Sections are not part of the new operating model. `sections` and `course_offering_sections` remain Legacy-only, and new `section_id` dependencies require documented compatibility necessity.
- `regular` and `parallel` remain fully isolated.

## Engineering decisions currently fail-closed

- Cross-tenant foreign-key hardening is merged source-only as PR #33; production application remains prohibited without separate approval and remote-history preflight.
- PR #30 remains isolated because it conflicts with `main`.
- Published and archived schedule versions remain locked against ordinary editing.
