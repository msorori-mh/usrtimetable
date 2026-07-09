# LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-LOVABLE-STAGING-VERIFY-01 — Report

**Phase decision:** ✅ **PASS_WITH_NOTES**  
**Next gate:** `LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-SUPABASE-TYPES-REGEN-PREP-01`

---

## 1. Identity
- **Supabase project ref:** `emzytxqkxjjhsivqxdiu` (Staging)
- **Schedule version id:** `482af19b-0d44-4631-b80a-753f5ead4089`
- **Version name:** `جدول 2025-2026-S — مستنسخ من legacy`
- **College id:** `7168345f-cf9d-4789-b2ad-547abb687dc8`

## 2. Migration records
Applied on Staging as 4 sequential records (see
`migration-object-verification.md`): `20260709213405`, `20260709213525`,
`20260709213902`, `20260709213956`. The combined schema effect matches the
SHA-verified canonical migration `20260709193500_schedule_version_conflict_exceptions.sql`
(SHA256 `b0528f29…`). No duplicates, no drift.

## 3. Table / function / trigger / RLS
- Table `public.schedule_version_conflict_exceptions`: **present**, 15 columns.
- PK + 2 FKs + `svce_session_pair_distinct` CHECK + `uq_svce_active_pair` unique index.
- Indexes: **5** (as spec).
- Triggers: **2** — `trg_svce_session_version_integrity` + `trg_svce_updated`.
- Function `ensure_svce_session_version_integrity`: **SECURITY INVOKER**, `search_path=public`.
- RLS **enabled** (not forced), **3 policies** (select/insert/update).

## 4. Seed row count — **44** ✅
## 5. Distribution — **22 / 20 / 2** (instructor / room / room_type) ✅
## 6. Pair / single split — **42 / 2** ✅
## 7. Approved covered instances — **86** ✅ (22×2 + 20×2 + 2×1)

## 8–9. Canonical full-validator result
| Metric | Expected | Observed |
| --- | ---: | ---: |
| totalHardConflicts | 96 | **96** ✅ |
| approvedHardConflicts | 86 | **86** ✅ |
| unapprovedHardConflicts | 10 | **10** ✅ |
| eligibility | FAIL | **FAIL** ✅ |

**Yes — the result is exactly 96 / 86 / 10.** Full JSON:
[`staging-verification/canonical-validator-results.json`](./staging-verification/canonical-validator-results.json).

## 10. Blockers (the 10 unapproved)
| # | code | course | section | room | required | issue |
|---|---|---|---|---|---|---|
| 1 | room_type_mismatch | IT-L2-003 (شبكات) | 1 | معمل-4 (computer_lab) | lecture_hall | wrong room type |
| 2 | room_type_mismatch | CIS-L1-002 (رياضيات متقطعة) | JWF-1 | جديد-23 (lecture_hall) | seminar_room | wrong room type |
| 3 | room_type_mismatch | CIS-L1-006 (لغة عربية 2) | 1 | الندوة (seminar_room) | lecture_hall | wrong room type |
| 4 | room_type_mismatch | CIS-L1-007 (مهارات عامة) | 1 | الندوة (seminar_room) | lecture_hall | wrong room type |
| 5 | room_type_mismatch | CIS-L1-001 (اساسيات نظم) | MRB-1 | الندوة (seminar_room) | lecture_hall | wrong room type |
| 6 | room_type_mismatch | CS-L2-001 (البرمجة الكينونية) | 1 | الندوة (seminar_room) | lecture_hall | wrong room type |
| 7 | room_type_mismatch | CS-L3-005 (قواعد بيانات 2) | 1 | الندوة (seminar_room) | lecture_hall | wrong room type |
| 8 | room_type_mismatch | CIS-L4-002 (التجارة الإلكترونية) | MRB-1 | الندوة (seminar_room) | lecture_hall | wrong room type |
| 9 | study_system_time_template | CY-L1-007 (لغة عربية 2) | 1 | جديد-35 | — | Thu 13:00–16:00 outside active template |
| 10 | room_type_mismatch | CIS-L1-002 (رياضيات متقطعة) | JWF-1 | الطب-الكبرى (lecture_hall) | seminar_room | wrong room type |

Classification: **9 × room_type_mismatch + 1 × study_system_time_template** ✅  
Full details: [`staging-verification/remaining-blockers.csv`](./staging-verification/remaining-blockers.csv).

## 11. Eligibility — **FAIL** (reason: 10 unapproved hard conflicts)
## 12. Status before/after — `draft` / `draft` (unchanged)
## 13. Sessions before/after — 198 / 198 (unchanged)
## 14. Published versions before/after — 0 / 0 (unchanged)
## 15. Quality runs before/after — 0 / 0 (unchanged)
## 16. Events before/after — 0 / 0 (unchanged)

## 17. F002 status — **OPEN — CONFIRMED**
The UI path `validateScheduleVersion` calls `applyApprovedExceptions(...)` with
no exceptions argument, so the conflict-checks page treats all 96 conflicts as
unapproved. Lifecycle eligibility (`evaluateEligibility`) is not affected — it
loads exceptions correctly, and G4 confirms 96/86/10 via the same code path.
See [`staging-verification/f002-status.md`](./staging-verification/f002-status.md).

## 18. Generated types status — **CURRENT** ✅
`src/integrations/supabase/types.ts` already includes
`schedule_version_conflict_exceptions` (regenerated automatically after
EXEC-01). Supersedes the EXEC-01 note.

## 19. Build / typecheck status — **no regression risk**
No source files edited (only new files under `docs/`). Build managed by
Lovable pipeline. See
[`staging-verification/build-static-verification.md`](./staging-verification/build-static-verification.md).

## 20. DB writes during VERIFY-01 — **0** ✅

---

## Decision matrix

| Criterion | Required for PASS | Result |
| --- | --- | --- |
| Migration installed, single logical instance | ✓ | ✓ |
| Seed = 44, distribution 22/20/2, pair/single 42/2 | ✓ | ✓ |
| Approved instances = 86 | ✓ | ✓ |
| Full canonical validator = 96 / 86 / 10 | ✓ | ✓ |
| Blockers = 9 room_type_mismatch + 1 study_system_time_template | ✓ | ✓ |
| Eligibility = FAIL | ✓ | ✓ |
| Zero side effects | ✓ | ✓ |
| No new High/Critical security findings | ✓ | ✓ |

Downgrades to `PASS_WITH_NOTES`:
- **F002** remains OPEN (does not affect lifecycle eligibility; blocks reliance
  on the conflict-checks UI number until fixed).

**Final decision:** ✅ **PASS_WITH_NOTES**

## Prohibited actions confirmed NOT performed
- No new migration / re-application of existing migration.
- No re-execution of seed.
- No `INSERT` / `UPDATE` / `DELETE` on any table.
- No modification of the 44 exceptions.
- No lifecycle transition; no `status` change.
- No persistent quality run.
- No Publish / Deploy.
- No modification of sessions, rooms, teaching assignments.
- No regeneration of Supabase types.
- No F002 fix.
- No blocker remediation.
- No source code changes (only `docs/staging-verification/*` and this report were created).
- No credentials, tokens, or connection strings exposed.

## Next
Proceed to `LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-SUPABASE-TYPES-REGEN-PREP-01`
under a separate approval. F002 and the 10 blockers are tracked in
[`staging-verification/remaining-actions.csv`](./staging-verification/remaining-actions.csv)
for their own future phases.
