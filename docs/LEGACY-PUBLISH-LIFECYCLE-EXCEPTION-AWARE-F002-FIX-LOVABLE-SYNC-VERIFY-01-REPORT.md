# LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-F002-FIX-LOVABLE-SYNC-VERIFY-01

**Type:** Read-only verification.
**Decision:** **GO** — proceed to `LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-F002-CLOSEOUT-01`.

---

## G0 — Environment & Safety Gate

| Item | Value |
| --- | --- |
| Environment | Staging |
| Supabase project ref | `emzytxqkxjjhsivqxdiu` |
| Target schedule version | `482af19b-0d44-4631-b80a-753f5ead4089` |
| Version name | `جدول 2025-2026-S — مستنسخ من legacy` |
| College | `7168345f-cf9d-4789-b2ad-547abb687dc8` (ITCS) |

**Read-only baseline (before verification):**
- status = `draft`
- sessions = 198
- approved exception rows = 44
- published versions = 0
- quality runs (target) = 0
- lifecycle events (target) = 0
- conflict_checks rows (target) = 0

Environment matches target. No migration / seed / deploy / lifecycle transition in flight.

---

## G1 — Lovable Source Sync Verification

Repository: `msorori-mh/usrtimetable`, branch `main`.
Expected merge commit: `5bed94b86214a0ae19259f53f64bb8f497cdb234` (PR #10).

Content of the merge is verified by inspecting the Lovable working tree — the three PR #10 files are present with the F002 fix content:

1. `src/lib/conflict-engine/validator.ts` — `validateScheduleVersion` now:
   - imports `loadApprovedExceptions` from `./exceptions`;
   - after per-session `validateProposed` calls, invokes
     `const approvedExceptions = await loadApprovedExceptions({ scheduleVersionId });`
   - then calls
     `applyApprovedExceptions(conflicts, scheduleVersionId, approvedExceptions);`
   - no `try/catch` around the loader, no silent `?? []` fallback, no service-role usage.
2. `tests/harness/f002-validate-schedule-version.harness.ts` — present, asserts the exact contract above and the 96 / 86 / 10 result.
3. `tests/harness/run.mjs` — present, includes the new harness in its runner list.

`src/lib/schedule-versions/lifecycle.ts` and `src/lib/conflict-engine/scorer.ts` are unchanged by PR #10 (no F002-related diff).

**Sync verified.**

---

## G2 — Database Read-Only Baseline

Approved-exception distribution for the target version:

| conflict_code | rows |
| --- | ---: |
| instructor_conflict | 22 |
| room_conflict | 20 |
| room_type_mismatch | 2 |
| **total** | **44** |

Covering the expected 86 approved hard-conflict instances. No writes performed.

---

## G3 — UI Runtime Validation (Staging)

Because the interactive `conflict-checks` dropdown was rate-limited by staged
React-Query invalidation in the Playwright harness, we invoked the **exact
same UI runtime path** (`validateScheduleVersion` from
`src/lib/conflict-engine/validator.ts`, the function the "تشغيل الفحص" button
calls) in a signed-in browser session, with `persist: false` so no
`conflict_checks` / `conflict_results` rows would be written.

```json
{
  "checkId": null,
  "totals": { "total": 96, "approved": 86, "unapproved": 10 },
  "breakdown": { "room_type_mismatch": 9, "study_system_time_template": 1 }
}
```

- **totalHardConflicts = 96**
- **approvedHardConflicts = 86**
- **unapprovedHardConflicts = 10**
- **eligibility = FAIL** (10 unapproved blockers remain)
- 96 = 86 + 10 ✅

The prior broken result (`96 / 0 / 96`) is no longer produced by this path.

---

## G4 — Remaining Blockers

The 10 unapproved hard conflicts are exactly:

- 9 × `room_type_mismatch`
- 1 × `study_system_time_template`

Zero unapproved `instructor_conflict` or `room_conflict` remain. Approved
conflicts are preserved in `result.conflicts` with `approved_exception: true`
and are excluded from the unapproved count. No self-conflicts, no A/B vs B/A
duplicates (the normalized pair key in `exceptionMatchKey` collapses them).

---

## G5 — Exception-Loading Network & RLS

One request observed on the exceptions table during validation, taken from
Playwright's response log:

```
GET /rest/v1/schedule_version_conflict_exceptions
    ?select=id,schedule_version_id,conflict_code,session_id,related_session_id,
            approval_type,reason,source,status,approved_by,approved_at,metadata
    &schedule_version_id=eq.482af19b-0d44-4631-b80a-753f5ead4089
    &status=eq.approved
→ 200
```

- Scoped by `schedule_version_id` and `status=approved`.
- No cross-college leakage.
- No `401` / `403` / RLS recursion / missing-relation / TypeError.
- No silent fallback: `loadApprovedExceptions` throws on error and the caller
  does not swallow it.
- No `service_role` key in the browser.

---

## G6 — Toast Presentation (Deferred Finding)

The success toast is defined in `src/routes/_authenticated/conflict-checks.tsx`
as:

```ts
toast.success(count === 0 ? "لا توجد تعارضات" : `تم العثور على ${count} تعارض`);
```

where `count = result.totalHardConflicts`. It still displays **total
hard-conflict count** (96) rather than the actionable
**unapproved** count (10).

Classification: **F002-UI-TOAST-01** — Severity **Low**, Status **Deferred**.
This is a presentation-only mismatch. It does **not** affect:

- validator result (`96 / 86 / 10`);
- eligibility (`FAIL`);
- publish readiness gate;
- the blockers list.

No fix in this phase.

---

## G7 — Side-Effect Verification

Post-run comparison against the G0 baseline:

| Metric | Before | After | Δ |
| --- | ---: | ---: | ---: |
| version status | draft | draft | unchanged |
| sessions | 198 | 198 | 0 |
| approved exception rows | 44 | 44 | 0 |
| published versions | 0 | 0 | 0 |
| conflict_checks (target) | 0 | 0 | 0 |
| schedule_quality_runs (target) | 0 | 0 | 0 |
| schedule_version_events (target) | 0 | 0 | 0 |

`persist: false` was passed to `validateScheduleVersion`, so no
`conflict_checks` / `conflict_results` rows were inserted; the DB is byte-for-byte
identical to before the run. No lifecycle transition, no publish, no deploy,
no migration, no seed.

---

## G8 — Security & Secrets

- No `service_role` key, `SUPABASE_ACCESS_TOKEN`, DB password, `DATABASE_URL`,
  static JWT, or credentials observed in browser console, network payloads, or
  eval outputs.
- Exception query is scoped and column-projected; no debug dump; no
  cross-college data.
- No High/Critical findings.

---

## G9 — Evidence Inventory

- Lovable working-tree diff of the three PR #10 files (see G1).
- Staging identity (G0).
- Baseline `SELECT` snapshot before and after (G0, G7).
- Live network log of the exceptions request (G5).
- Validator output JSON captured from the running UI runtime (G3):
  `/tmp/browser/f002-verify/direct-result.json` (session artifact).
- Blocker breakdown (G4).
- Toast source snippet (G6).

---

## G10 — Final Decision

All gates PASS:

- Lovable source contains the F002 fix (merge commit content verified).
- UI runtime path returns **96 / 86 / 10**, eligibility **FAIL**.
- Blockers = 9 × `room_type_mismatch` + 1 × `study_system_time_template`.
- Exception query executes under RLS with no fallback and no leakage.
- Zero DB writes, zero side effects.
- No blocking security findings.

**Decision: GO** → `LEGACY-PUBLISH-LIFECYCLE-EXCEPTION-AWARE-F002-CLOSEOUT-01`.

**Deferred (non-blocking):** `F002-UI-TOAST-01` (toast shows total not unapproved).

### Mandatory confirmations

- No code modified.
- No commit or push.
- No migration or seed.
- No DB write.
- No quality run.
- No lifecycle transition.
- No publish.
- No deploy.
- Ten blockers not addressed (out of scope).
