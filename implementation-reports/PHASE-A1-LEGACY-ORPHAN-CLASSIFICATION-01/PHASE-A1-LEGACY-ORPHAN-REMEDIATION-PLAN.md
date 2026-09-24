# PHASE-A1-LEGACY-ORPHAN-REMEDIATION-PLAN

Status: **DESIGN ONLY — NOT AUTHORIZED TO EXECUTE**  
Gate: `APPROVE_LEGACY_DATA_REMEDIATION`  
Scope: 174 `teaching_assignments` with `section_id` + 5 `course_offering_sections`

## Non-negotiables

- No remediation without the approval gate.
- No assumption that orphans are “just test data”.
- Preserve auditability; prefer unlink/null over silent delete unless SAFE_TO_UNLINK is proven.
- A1.3c DB write-hardening (`20260721090000_…`) must remain **after** remediation (COS writes would otherwise be blocked without the operator GUC window).

## Prerequisites (from classification package)

1. Run `PHASE-A1-LEGACY-ORPHAN-CLASSIFICATION-READONLY.sql` on Production (read-only).
2. Export exact-ID manifests + MD5 checksums (§5).
3. Human review of every `UNKNOWN` and `REQUIRED_FOR_OPERATION` row.
4. Freeze new Legacy writes (already source-blocked in A1.3a; A1.3c after remediation).

## Future execution checklist (only after approval)

1. **Backup**
   - Dated `zz_backup_ta_section_orphans_<YYYYMMDD>` and `zz_backup_cos_<YYYYMMDD>` as SELECT INTO / dump of exact IDs only.
2. **Exact-ID manifest**
   - Use §5 MD5 + full ID lists; reject if counts ≠ 174 / 5.
3. **Dependency graph**
   - Re-run session / TA / COS dependency queries immediately before apply.
4. **Dry-run**
   - Transaction with `ROLLBACK` printing before/after counts per classification bucket.
5. **Rollback**
   - Restore from backup tables by exact ID; re-verify MD5.
6. **Before/after counts**
   - Snapshot metrics from §0 + classification tally.
7. **Audit preservation**
   - Write `audit_logs` entries for every mutated ID (actor, reason, classification).
8. **Execution order (proposed)**
   1. `REQUIRED_FOR_OPERATION` — manual decision only (may stay linked).
   2. `MIGRATABLE_TO_V2` — prefer point to existing V2 TA / null `section_id` after verifying alternative.
   3. `SAFE_TO_UNLINK` — null `section_id` on TA; delete or archive COS rows only if no refs.
   4. `LEGACY_HISTORICAL` / `TEST` — case-by-case with documented reason.
   5. `UNKNOWN` — **do not touch**.
9. **Verification queries**
   - Re-run §0/§4; expect orphan TA/COS reduced only for approved IDs; New Flow `delivery_group_id` sessions unchanged.

## Stop condition

Halt here until: **`APPROVE_LEGACY_DATA_REMEDIATION`**.
