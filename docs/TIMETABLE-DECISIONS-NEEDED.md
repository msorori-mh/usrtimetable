# Timetable Decisions Needed

Only decisions that cannot safely be inferred belong here.

## User approval required

1. Any production migration/apply, database write, deploy, publish, or change of an actual schedule version to `published`.
2. Authoritative policy for Course Offerings: the current UI implements CRUD, while the initialization decision says the page must not become unapproved CRUD. Until resolved, no expansion of CRUD behavior is authorized.
3. Migration-history reconciliation and an approved one-migration apply sequence after the remote applied list can be obtained. Runtime remains closed meanwhile.

## Engineering decisions currently fail-closed

- Cross-tenant foreign-key hardening will be drafted only; it will not be applied.
- PR #30 remains isolated because it conflicts with `main`.
- Published and archived schedule versions remain locked against ordinary editing.
