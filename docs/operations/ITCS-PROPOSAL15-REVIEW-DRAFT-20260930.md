# ITCS proposal 15: platform review draft

The user requested that the reviewed 30/9 proposal be saved as a draft inside
the platform. Live coordination checks identify seven proposed sessions with
external instructor overlaps (including linked identities). Operational schedule
insertion would therefore be rejected. Do not disable that guard, approve new
exceptions implicitly, alter the reviewed placements, or modify another college.

This change stores the complete proposal as a **review document**, distinctly
labelled in the UI. It does not create a `schedule_versions` record, teaching
assignment, approval, exception, or operational session. Conversion to an
operational draft remains blocked pending resolution of the displayed overlaps.

## Data and access

- The reviewed payload, original membership data, offline checks and proposed
  native import mapping are registered privately in the existing platform DB.
  No real timetable, lecturer identity, source snapshot or registration payload
  is included in this public repository.
- Registration validates every observed source-session field. Save uses the
  registered payload hash and source snapshot CAS; the caller cannot supply a
  different timetable. The sole writer is `public.itcs_cutover_execute` under
  the authenticated Super Admin session.
- Registry and saved proposals are private tables with RLS and no client table
  grants. Read RPC requires authentication; unsaved previews are Super Admin
  only; saved copies require the existing college-view permission.
- Idempotent save, atomic audit log, no publishing stage. Live conflict checks
  remain visible after saving and are timestamped separately from offline checks.
- Page `/itcs-review-proposal`; linked from ITCS schedule versions and cutover.

## Verification

Three disposable PostgreSQL tests cover authorization, exact manifest/source
CAS, forbidden publication, idempotence, full payload persistence, operational
data preservation, private-table access, and rollback when the audit insert fails.
TypeScript and the production build pass. The test is included in clone-current
CI. Deployment requires the additive schema migration, private registration
through the authorized platform database connection, and verification of the
actual save in the signed-in UI. A stored review document must never be reported
as an operational timetable draft or as ready to publish.

## Security review

New private tables and narrowly scoped RPCs; existing RLS, authentication,
authorization, schedule guards and publication checks are unchanged. React
renders report values as text. No credentials, extra access grants, public
sharing, or operational academic-data edits. Production risk: low, additive
review-document storage. The abandoned operational importer is not included.
