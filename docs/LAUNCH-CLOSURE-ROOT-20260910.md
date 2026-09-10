# Root launch verification — 2026-09-10

Overall decision: HOLD for final authenticated native PDF/XLSX artifact verification. This is not a claim of complete launch readiness.

## Delivered

- Candidate: fc339ae79c7cc7cbf1a195266ab5252e8a9fa7e0. Project agent finished before deployment; no queued code work observed.
- Deployment requested through Lovable, deployment ID 9a519522-f03e-45bb-9643-966721b0d610. Root subsequently observed the new print/export link and corrected logical footer on https://gomufadhala.com with the authenticated TEST ONLY college-admin account. The deployment API initially returned pending; completion is evidenced by these live features, not a separate deployment-status response.
- Source tests reported by the implementation worker: 163/163, 547 assertions; consistency harness 68/68; typecheck and build successful. Changed production files lint clean. Unrelated repository lint debt is not represented as resolved.
- Root read RESULTS.json at d8be1c60: 79 actual Chromium fixture print/export checks passed, failed array empty. Independently retrieved/rendered the regenerated A3 landscape PDF; physical page 2 correctly says 2 of 16, distinct from logical group 1 of 8. Earlier short and long render inspections found readable Arabic and no clipped columns.

## Database and real account verification

- Original applied artifact: docs/migrations-proposed/20260910T0025_availability_temporal_integrity_and_bulk_rpc.sql at db4bb418, applied verbatim by root via configured Lovable query_database in one transaction.
- Native migration bookkeeping completed by the implementation worker. Root independently queried history version 20260910011503 and compared canonical supabase/migrations/20260910011503_92afea39-a76f-46d9-a7db-b95bf1b60310.sql against the actually applied text: identical after trimming trailing whitespace.
- Policy count correction: TEN policies (2 audit + 4 instructor + 4 room), not eleven. Root's stored preflight and subsequent reads have matching names, roles, commands, qualifications and checks. No policy change.
- Root tested instructor and room save/read/delete via the authenticated TEST-SIMP-03 college-admin UI. New RPC execution independently evidenced by audit details mode=single_day and days_created=1.
- Instructor overlap 09:00–12:00 against existing 08:00–12:00 rejected with explicit Arabic conflict/all-or-nothing toast. No extra row was saved.
- Exact temporary test rows removed through UI. Global baseline restored: instructor_availability=0, room_unavailability=1. No real-college records changed. Audit evidence retained.
- Existing TEST schedule 5b838e0c-5cad-4822-a8bb-73d9641bbcd9 was already published; root did not republish or alter its sessions. Live print view after deployment shows practical Sunday 08:00–10:00 and theory Monday 08:00–10:00 with correct test course/instructor/room/cohort and published read-only status.
- New database integrity had 40 disposable PostgreSQL runtime cases including real concurrent exclusion conflict, role denial, idempotency and rollback. These are isolated runtime tests, not a claim that every production account was impersonated.

## Remaining gate

Authenticated native output capture is still OPEN: root's browser export capability reported unsupported tab_content_export; Excel and CSV download-event waits timed out. This does not prove an application download failure. Fixture-based actual PDF/CSV/XLSX files pass; live authenticated data is visible, but a PDF and XLSX downloaded from this exact session have not been inspected.

Required final evidence: use the prepared live TEST schedule print screen, save via Print to PDF, download Excel, and provide the two files for inspection. Confirm two sessions, readable Arabic, correct course/instructor, no clipped columns, and accurate pagination. External distribution to students is performed by staff and is outside the platform's launch gate.

## Advisor follow-up, not silently closed

The native workflow reports fixed-search-path warnings for four availability helpers and btree_gist in public. These objects originated in this availability repair and were already live before history registration; they must not be mislabeled as all predating the overall repair. The RPCs are SECURITY INVOKER and existing table RLS remains enforced. Forty older SECURITY DEFINER advisor entries are unrelated to this change. No blanket clean security-advisor claim is made; assess these findings separately before asserting all security debt is closed.
