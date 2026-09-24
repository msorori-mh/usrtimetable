# Disposable Draft Purge + RBAC Readiness

Status: **SOURCE COMPLETE — WAITING FOR CONTROLLED MIGRATION APPLY**

Protected accepted schedule version (never modify/approve/publish/purge):

`835e50fe-3ad2-4232-8c15-0f403c668a7f`

## Why schema change is required

No existing `schedule_versions` column or safe metadata contract can mark a clone as `disposable_test = true` without ambiguity. Notes/metadata parsing is rejected as fail-open. Source-only migration adds:

1. `schedule_versions.disposable_test boolean NOT NULL DEFAULT false`
2. Trigger: only `super_admin` may set/flip the marker
3. RPC: `purge_disposable_draft_schedule_version(p_version_id uuid) RETURNS jsonb`

## Purge contract

Allowed only when **all** hold:

- authenticated caller
- `is_super_admin(auth.uid())`
- `disposable_test IS TRUE`
- `status = 'draft'`
- version id ≠ protected UUID
- no cross-college dependent rows
- dependents scoped to target version + college

Rejected for: `college_admin`, `read_only`, anon, PUBLIC (execute revoked), unmarked drafts, approved/published/archived/review, protected id.

Atomic: deletes quality runs, conflict exceptions/results/checks, auto schedule runs, events, sessions, then version in one transaction; orphan check fail-closed; idempotent `already_absent` on re-call.

## Clone path

`cloneVersion({ disposableTest: true })` is opt-in and **super_admin only**. Default clones remain `disposable_test = false` and are not purgable via this RPC. No general UI delete button.

## Path decision

**Path B** — migration required and **not applied**. Do not merge product behavior that depends on unapplied SQL into production until Lovable-managed apply approval.

After apply approval: create disposable draft `RBAC-TEST-ITCS-OVERNIGHT-01`, run college_admin / read_only live matrix, then purge via official RPC, then verify protected 54-session baseline unchanged.

## Apply package

See `docs/PLATFORM-LAUNCH/apply-packages/DISPOSABLE-DRAFT-PURGE-APPLY.md`.
