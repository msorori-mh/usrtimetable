# CODEX STAGE 03I-B — V2 Duplicate Contract Audit

## EXECUTIVE_SUMMARY

The observed preview has 156 source `READY` rows but only 142 unique
`delivery_group_id|instructor_id` keys. The source and SQL contracts prove that
the missing dimension is not a legitimate workload dimension:

- the active database uniqueness index is
  `(college_id, delivery_group_id, instructor_id)` where `is_active = true`;
- one import job is college-scoped, so its batch key is
  `delivery_group_id|instructor_id`;
- assigned hours, notes, offering, active state, room requirement and session
  type are attributes of that assignment, not additional identity fields;
- co-teaching is represented by different instructor IDs for one delivery group.

Therefore identical duplicates are repeated representations of one assignment.
Different payloads for the same key are conflicting instructions, not multiple
workload records.

## CONFIRMED_BUG

Before this change:

1. `sourcePreviewToValidatedRows` returned every matched expansion as an import
   row and the UI displayed that count as valid rows.
2. The job handler delegated all rows in input order to
   `commit_teaching_assignments_v2_import`.
3. The RPC selected the current assignment for each key and processed rows
   sequentially. Two conflicting rows could update the same assignment twice.
   The last row silently became authoritative.

This was a real first/last-row-wins defect. Database uniqueness prevented two
active records, but did not prevent order-dependent mutation.

## NATURAL_KEY_EVIDENCE

| Evidence | Result |
| --- | --- |
| `ta_v2_delivery_group_instructor_uniq` | unique `(college_id, delivery_group_id, instructor_id)` for active V2 rows |
| RPC lookup | existing assignment selected by college, delivery group and instructor |
| resolver payload | resolved `_delivery_group_id` and `_instructor_id` are mandatory |
| workload model | assigned component hours belong to the assignment; they do not create a second assignment |
| co-teaching contract | multiple instructors are separate keys and require explicit hour splits |

**Canonical batch key:** `delivery_group_id|instructor_id`, under the import
job's single `college_id`.

## DUPLICATE_CLASSIFICATION

| Fixture | Classification | Contract |
| --- | --- | --- |
| byte/semantic-identical duplicate | duplicate, valid | collapse to one operation; retain both provenance entries |
| same key, different hours | conflict | block the entire preview/import |
| identical rows from two sheets | duplicate, valid | collapse; retain both sheet/row origins |
| duplicate caused by expansion | duplicate, valid | collapse; retain both expansion origins |
| same key, different operational payload | conflict | block; never first/last-row wins |

The anonymized count fixture reproduces `156 READY → 142 canonical operations`
with 14 identical duplicate representations and zero conflicts.

## PAYLOAD_AND_IDEMPOTENCY

Operational comparison covers:

- delivery group;
- instructor;
- assigned component hours;
- active state;
- compatibility offering;
- notes;
- expected students;
- required room type;
- component/session mapping.

Canonical order is deterministic. Re-running the same input produces the same
operation array and provenance. The persisted manifest stores canonical rows
with `_source_provenance`, so identical rows are not silently discarded from
audit evidence. Import counters are based on canonical operations.

Any conflicting key makes the canonical operation array empty and emits
`conflicting_assignment_duplicate`; no partial subset can be committed.

## SOURCE_CHANGES

- `src/lib/excel-import/teaching-assignments-v2-canonical.ts`
  - natural-key grouping;
  - deterministic identical collapse;
  - provenance aggregation;
  - fail-closed conflicts.
- `src/lib/excel-import/teaching-assignments-source-resolver.ts`
  - canonicalizes matched expansions before manifest creation;
  - exposes source-ready and canonical counts.
- `src/lib/excel-import/teaching-assignments-source-import.ts`
  - carries both counts to the preview.
- `src/routes/_authenticated/import.tsx`
  - separately displays source `READY` rows and canonical import operations;
  - commit label uses canonical operation count.

## SQL_SOURCE_CONTRACT

Source-only migration:

`supabase/migrations/20260728010000_teaching_assignments_v2_duplicate_contract.sql`

It:

- rejects different operational payload variants for one natural key;
- deterministically collapses identical operations before the atomic V2 RPC;
- retains provenance in `import_jobs.validated_payload`;
- revokes authenticated direct execution of the lower-level RPC so clients
  cannot bypass the canonical import-job handler;
- keeps `SECURITY DEFINER` with fixed `search_path`.

The migration was created but **not applied**.

## REGRESSION_TESTS

- `tests/fixtures/teaching-assignments-v2-duplicates/cases.ts`
- `tests/harness/teaching-assignments-v2-duplicate-contract.harness.ts`
- `tests/harness/teaching-assignments-v2-duplicate-sql-contract.harness.ts`

Coverage includes all five requested duplicate classes, exact 156/142
accounting, deterministic replay, provenance preservation, fail-closed
conflicts, natural-key SQL evidence, canonical SQL collapse, authorization and
fixed `search_path`.

Final validation:

- `git diff --check`: PASS (line-ending notices only; no whitespace errors);
- `bunx tsc --noEmit`: PASS;
- `bun run build`: PASS;
- `bun test`: PASS — 4 passed, 0 failed;
- `bun run test:harness`: PASS — 51 passed, 0 failed, 0 missing.

## PRODUCTION_ACTION_REQUIRED

Before the controlled V2 import, an authorized production migration operator
must review and apply
`20260728010000_teaching_assignments_v2_duplicate_contract.sql`, then rerun the
read-only preview and confirm:

- source READY rows = 156;
- canonical operations = 142;
- conflicts = 0;
- import manifest valid row count = 142.

No production write, migration apply, data import or publish was performed by
this task.

## ROLLBACK

If the source migration must be rolled back before any import, restore the prior
`_import_apply_teaching_assignments_v2` definition and its prior grants from the
authoritative preceding migration. Do not roll back after a commit without
first reconciling the import job, audit batch and assignment rows.

## FINAL_DECISION

`READY_FOR_CANONICAL_V2_IMPORT`

This decision means the source contract is ready. The controlled production
import remains gated on authorized application and verification of the
source-only migration above.
