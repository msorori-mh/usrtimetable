# Faculty college correction from university identity linking

Baseline: `f1a84b573959e3b06e8ebecc8c38c9ae59f3fdb5` on `main`.

## Behavior

In **ربط الهوية الجامعية**, administrators can choose **نقل إلى كلية أخرى**. The form loads the current canonical identity, displays its current college, limits destinations to other colleges in the same university, previews the destination, and requires a correction reason and explicit confirmation. It is available from both the instructor directory and university faculty report.

The operation uses the existing `reconcile_faculty_home` RPC. A corrected lecturer appears once in the destination home roster and leaves the previous home roster. All linked aliases acquire the corrected affiliation. The university identity/number, operational instructor IDs and owning colleges, employment data, raw hours, teaching assignments, sessions, groups and published versions stay intact. Existing teaching in another college remains teaching there; the operation does not move lectures.

The authoritative source record is retained. Quota approval is an explicit separate choice, unchecked by default. Without it, recorded hours remain stored but the new home quota and resulting surplus/deficit stay pending review. An old-college department is cleared by the existing server rule; the administrator completes the destination department through normal instructor editing.

The form rejects incomplete/error reads, unrelated identities, invalid destinations and missing confirmation. Changing the destination, evidence, source quota or saved decision invalidates confirmation. Pending requests prevent switching dialog actions or dismissing the dialog. Failed saves retain user input and show the error without reporting success.

## Security review

- Application files: identity dialog, new transfer component and validation helper, and the two entry points. Tests: correction UI/payload plus extended home-roster database tests. CI: college-instructor-directory workflow.
- No migration, new RPC, RLS, table permission, authentication or secret changes.
- The existing server RPC requires a signed-in super administrator, validates same-university destination and identity membership, serializes changes, checks the previous decision timestamp and writes an audit event with before-state and reason. Existing password/MFA/session protections remain in force.
- Client checks improve review; they do not replace server authorization. No SQL/HTML is assembled from user inputs. No production lecturer was chosen or moved during development.
- Production risk: low for UI deployment. Actual affiliation corrections intentionally change college headcounts and role-scoped home rosters, while preserving teaching records. They require the administrator's explicit in-product confirmation.

## Evidence and release gate

PASS locally: 6 form/payload behavior tests, 15 PostgreSQL roster/scope tests, TypeScript no-emit, production build, scoped ESLint and diff checks. The database test uses synthetic local identities, checks all non-admin roles, another university, mismatched source, insufficient evidence and stale decisions. It compares complete identity/assignment/session/version/group/source-row snapshots and instructor fields outside the intended affiliation changes before/after, and verifies the audit event.

Release requires successful checks on the exact PR head and observing the new dialog in the published app. Live verification opens and previews the form only; no real lecturer is moved without a specified correction. Code readiness is not evidence that a particular lecturer has been transferred.

Rollback: revert this UI/CI commit. There is no migration to roll back. If a human later confirms an incorrect college, make a new audited correction with the current decision timestamp; do not delete the identity, audit history or operational teaching records.
