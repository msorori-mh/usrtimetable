# Jawf program transfer: stage 1

Baseline: `a775f4b652bd99e372732d139b21760d1502cd6b`.

Academic owner and assignment/scheduling manager: Jawf college
`0d0e89c6-d041-43de-a448-249070ef6c81`, plus super admin.
Teaching venue remains the existing ITCS facilities. No physical room or lecturer
identity is duplicated. Internal department members: Mubarak Al-Sufiani, Mohammed
Makrad and Ahmad Al-Badawi. Other teachers are external to Jawf.

Source program: `dd991d15-aef5-4e3e-a59d-724a89ee1f66`.
Existing empty destination program: `81b3c548-551b-4263-b2ce-b9c981d23e48`.
Reference curriculum: ITCS CIS. Preserve existing weekly times, student groups,
faculty identities, room IDs and historical published sessions.

## Implemented, not applied

The foundation migration adds private, program-specific room grants, an audited
admin-only grant/revoke RPC and a receiving-college read RPC. Its readers return
only room display fields and host college identity. They do not expose sessions,
students or instructor details from the host. The receiving college cannot edit
host inventory. Cross-university grants, spoofed program scopes, null enable flags,
short evidence and direct authenticated table access are rejected. Revocation
cannot invalidate any non-archived session. Writes share the existing coordination
serialization gate.

The foundation deliberately does not enable placement or transfer records yet.
Existing room and instructor scope guards, RLS and publication locks remain intact.
Do not apply this migration as though it completed the requested transfer.

## Verified locally

Seven PGlite tests passed: three room-grant authorization/history tests and four
physical-room conflict tests. Conflict checks cover adjacent intervals, weekdays,
term intersections, published/coordination/archived references, missing dates,
self-exclusion and rejection of unprivileged probes. The conflict checker remains
private and is not yet wired into placement triggers or the UI.

```sh
npm install --prefix /tmp/hosting-test --no-package-lock --ignore-scripts @electric-sql/pglite@0.5.8
HOSTING_DB_MODULE=/tmp/hosting-test/node_modules/@electric-sql/pglite/dist/index.js node --test tests/hosted-program-facilities.test.mjs tests/hosted-room-conflicts.test.mjs
```

These tests prove the new RPC contract against a small fixture, not compatibility
with every production constraint. No production test rows or grants were created.

## Transfer preflight: HOLD

50 active assignments associated with 50 sessions in published V2 involve 27
instructor rows. User clarification dated 2026-09-19 resolves the earlier questions:

- Shamsan Al-Jarash belongs to Education and Sciences. The conflicting Arts record
  `4f57f9b0-c508-4a2c-a027-f7b85c64f879` was corrected in production to home college
  `1ee291b2-bec9-43d3-b42b-5a4f46946399`. Its Arts affiliation department was cleared;
  no replacement department was guessed. The linked canonical profile now resolves
  to Education and Sciences. The existing 12-hour recorded quotas were preserved.
  The transaction asserted identical hashes of every assignment, session and faculty
  number before/after and recorded an audit event. No identity was merged or created.
- `e19a14ef-2aff-4e6f-9074-c61f2952cdc7` is intentionally a placeholder pending a
  lecturer from Administrative Sciences, not a real lecturer. The user will assign
  the real person tomorrow and then retire the placeholder. Preserve Sunday
  08:00–11:00 for Principles of Business Administration. Do not delete the placeholder,
  invent a person, approve its quota or treat it as a confirmed teaching engagement.
  Pending-teacher presentation/workload handling still needs implementation; existing
  live reports have not yet been changed to exclude this placeholder.

Several borrowed quota sources remain unconfirmed under the faculty-home workflow;
preserve recorded values and do not silently mark them approved.

## Remaining implementation and release gates

1. Represent the acknowledged pending-teacher slot without losing its room/time or
   assigning a fictitious faculty load; replace the teacher only once named.
2. Integrate program-specific room authorization into placement, validation,
   availability, hydration and room selection; retain host availability constraints.
3. Add serialized cross-college room collision checks covering published and
   coordination versions, including overlapping terms and matching weekdays.
4. Prepare a complete FK-aware transfer manifest, preserving history through the
   normal version lifecycle. Never disable triggers, FK/RLS or publication locks.
5. Transfer curriculum, cohorts, offerings, groups and approved assignments. Keep
   unpublished edits distinct from the published schedule; do not silently discard
   existing draft differences or count source and target workloads twice.
6. Verify receiving/host/admin/read-only roles, preserved session tuples and counts,
   curriculum parity, shared groups, workload attribution and printed Jawf headings.
7. Apply and publish only after the complete code, transfer and rollback evidence pass.

Security review: new private RLS-enabled table and two authenticated RPCs; no existing
RLS/auth changes, no guest facility-edit permission. The only production write so far is the separately
audited, user-authorized Shamsan affiliation correction; no hosting schema/grants,
schedules, assignments, faculty numbers or program records were changed.
This is a foundation draft, not ready to merge/deploy as a complete transfer.
