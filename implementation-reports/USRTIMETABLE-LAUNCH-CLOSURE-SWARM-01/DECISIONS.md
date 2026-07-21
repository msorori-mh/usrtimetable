# DECISIONS — USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01

- D-STATE-01 (2026-07-22): The repo (origin/main) is the permanent state source; /mnt/agents/output is never a state source. On new sessions, fetch state from origin/main; stop only if GitHub is unreachable or evidence conflicts.
- D-STATE-02 (2026-07-22): State provenance = RECONSTRUCTED_FROM_GITHUB_AND_USER_CONFIRMED_EVIDENCE. Undocumented memory was not used.
- D-DRIFT-01 (2026-07-22): origin/main drift after user-confirmed 91b5f65 (4 lovable-dev commits up to 6c4401bb) is recorded, not hidden. The drift is consistent with the confirmed rejection of the legacy classification package. Final-main gates package targets the user-confirmed SHA 91b5f65 by default and accepts -TargetSha override; user decides whether gates must instead run on 6c4401bb.
- D-LEGACY-01: LEGACY_ORPHAN_CLASSIFICATION_V1 = REJECTED (assumed delivery_groups.course_offering_id, which does not exist in Production). Never rerun; never guess the delivery-group relationship. Relationship discovery happens only via the read-only PHASE-A1-LEGACY-RELATIONSHIP-SCHEMA-MAP.
- D-LEGACY-02: Source-side (unapplied) migration 20260717050000 references delivery_groups.cohort_id / plan_course_id / component_id. These are SOURCE_ONLY candidates until confirmed by remote schema evidence.
- D-MIG-01: No migration is applied without remote evidence + APPROVE_DB_MIGRATION_APPLY. Expected order: 20260717050000 -> 20260720143000 (when confirmed) -> 20260721180000 -> approved headcount entry -> A2.
- D-MIG-02: 20260721090000 (legacy write hardening) is conditional on Legacy data remediation first (A1.3b before A1.3c); do not apply now.
- D-SAFE-01: No DB writes, no backfill/cleanup, no touching the 174 TA / 5 COS rows, no real import, no deploy/publish, no duplicate PRs, no re-running PRs #60/#61/#62, no branch/worktree deletion, no "Production ready" claims.
