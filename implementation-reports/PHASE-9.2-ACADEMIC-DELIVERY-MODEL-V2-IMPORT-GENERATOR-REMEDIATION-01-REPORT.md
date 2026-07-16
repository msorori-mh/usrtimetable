# PHASE-9.2-ACADEMIC-DELIVERY-MODEL-V2-IMPORT-GENERATOR-REMEDIATION-01

## 1. القرار

**PASS — PHASE_9_2_REMEDIATION_COMPLETE_PR_UPDATED**

---

## 2. Baseline / previous PR head

| Field | Value |
|---|---|
| Baseline `origin/main` | `8ef4226c06fbf5d45aca83212065f46f7c1de325` |
| Previous PR HEAD | `3b8c5222c7bebcfd2663aa16daf5403d9335d252` |
| Branch | `phase-9-2-academic-delivery-v2` |
| PR | https://github.com/msorori-mh/usrtimetable/pull/29 |
| Worktree | `C:\projects\usrtimetable-phase9-2` |

### G0 notes

- Branch / local HEAD / PR head matched previous SHA before remediation commit.
- `origin/main` unchanged at baseline.
- PR OPEN, not draft, MERGEABLE/CLEAN.
- Worktree had known local dirt (`src/routeTree.gen.ts` uncommitted TanStack Register noise; prior IMPL-01 report under `implementation-reports/`). Not cleaned (forbidden). Those files were **excluded** from the remediation commit.
- Migration `20260716030000` remains **NOT APPLIED** (source-only edit).

---

## 3. الملفات المعدلة (remediation scope)

| File | Change |
|---|---|
| `supabase/migrations/20260716030000_generate_cohort_curriculum.sql` | Auth gate + semester filter + elective_slot_courses validation |
| `src/routes/_authenticated/course-offerings.tsx` | Read-only diagnostic page; no Create/Edit/Delete |
| `src/lib/academic-delivery/plan-course-components.ts` | Semester/elective validation helpers for contracts |
| `src/lib/excel-import/validators.ts` | Enforce selected course ∈ `elective_slot_courses` |
| `tests/harness/academic-delivery-v2-import-generator.harness.ts` | Remediation contract coverage |
| `implementation-reports/PHASE-9.2-ACADEMIC-DELIVERY-MODEL-V2-IMPORT-GENERATOR-REMEDIATION-01-REPORT.md` | This report |

**Not committed:** `src/routeTree.gen.ts` (local dirt), prior IMPL-01 nested report.

**Not touched:** Phase 9.1 migration `20260716025117_…sql`, `usrtimetable-mainline`, Schedule Builder RPCs.

---

## 4. إصلاح auth / can_manage_college

- Signature confirmed: `can_manage_college(_user_id uuid, _college_id uuid)`.
- Flow: load `academic_cohorts` by `p_cohort_id` → derive `college_id` from row → `v_uid := auth.uid()` → reject NULL → `can_manage_college(v_uid, v_cohort.college_id)` → else `RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501'`.
- No client-supplied `college_id` parameter.
- `SECURITY DEFINER` + `SET search_path = public` retained.
- `REVOKE … FROM PUBLIC, anon`; `GRANT EXECUTE TO authenticated, service_role` (no new service_role bypass inside function; matches prior Phase 9.2 grant pattern).

---

## 5. تصفية semester

- Resolve `academic_terms.term_type` for cohort term (`first` → semester `1`, `second` → `2`).
- Fail closed on missing term / unsupported `term_type` (`COHORT_TERM_TYPE_UNSUPPORTED`) — no NULL wildcard.
- Required `plan_courses` filtered by: plan (program), `level_id`, `semester = v_semester`.
- `study_system` applied on generated `course_offerings` from cohort (plan_courses has no study_system column).
- Elective slots also filtered by `es.semester = v_semester` (+ plan/level/active).

---

## 6. تحقق elective_slot_courses

**RPC**

- Unselected active slots in plan/semester → warning `ELECTIVE_SLOT_UNSELECTED`; no placeholder offering.
- Selections must match plan/semester/level context (`ELECTIVE_SLOT_CONTEXT_MISMATCH`).
- Selected course must exist in `elective_slot_courses` with `active` true (`ELECTIVE_COURSE_NOT_IN_SLOT`).
- Placeholder codes `(E)` / `XX(E)` rejected (`ELECTIVE_PLACEHOLDER_FORBIDDEN`).

**Import validator**

- Loads `elective_slot_courses` membership map.
- Rejects with `elective_course_not_in_slot` when selected course not listed for the resolved slot.

---

## 7. منع CRUD عبر direct URL `/course-offerings`

- Route retained for compatibility / Schedule Builder references.
- Page is read-only diagnostic: Arabic internal-layer message shown.
- Removed: Create button, Dialog form, Edit/Delete buttons, `useMutation`, insert/update/delete calls.
- Nav remains without `/course-offerings` link (unchanged hide).

---

## 8. أثر Schedule Builder

- No changes to SB workspace load, save/validate/move RPCs, or teaching_assignments legacy fields.
- `course_offerings` table contract unchanged; generator still inserts compatibility rows only.
- Route `/course-offerings` still registered; read path preserved.
- Phase 9.1 / prior session-move migrations untouched.

---

## 9. نتائج الجودة

| Check | Result |
|---|---|
| Harness Phase 9.2 | **PASS** (static/logic contracts; no runtime DB proof) |
| `bunx tsc --noEmit` | **PASS** (exit 0) |
| `npm run build` | **PASS** (exit 0) |
| `npm run lint` | **FAIL baseline** — ~39k prettier CRLF `Delete ␍`; new Replace issues in modified files fixed via prettier. Pre-existing `no-explicit-any` on `validators.ts:31` unchanged. |
| `git diff --check` | **PASS** |

Harness covers: unauthorized/auth gate source, cross-college gate source, semester isolation, elective allow/deny/wrong-slot/wrong-plan-semester, placeholder no-selection, summer skip, idempotent rerun, read-only offerings UI, SB `course_offerings` refs present.

---

## 10. Static SQL review

| Item | Verdict |
|---|---|
| Table/column names (`academic_cohorts`, `plan_courses.semester`, `elective_slots`, `elective_slot_courses.active`, `academic_terms.term_type`) | OK |
| `can_manage_college(v_uid, v_cohort.college_id)` arg order | OK |
| Soft EXISTS idempotency (no ON CONFLICT; co_unique still race-safe at DB) | OK / prior MEDIUM race note remains |
| `search_path = public` | OK |
| Grants/revokes | OK |
| `auth.uid()` null + manage gate before operational loops | OK |
| No trigger / backfill / auto-invoke | OK |
| No DML outside function body | OK |
| No sections / COS / delivery_groups / schedule_sessions / teaching_assignments mutation | OK |
| Parser DB execution | **Not run** (forbidden) |

---

## 11. تأكيدات إلزامية

| Constraint | Confirmed |
|---|---|
| Migration **CREATED — NOT APPLIED** | YES |
| No DB writes | YES |
| No Supabase push/reset/seed | YES |
| No deploy / publish | YES |
| No merge / auto-merge | YES |
| Same PR #29 updated (no new PR) | YES |
| Phase 9.1 migration untouched | YES |
| `usrtimetable-mainline` untouched | YES |
| No stash/reset/clean/delete | YES |

---

## 12. ملاحظات باقية

- Concurrent double-insert race still may hard-fail (MEDIUM from prior review; out of remediation scope).
- Import slot resolution by `slot_code` suffix remains fuzzy across plans (MEDIUM); RPC now enforces plan/semester context + membership.
- Final runtime proof of auth/semester/elective behavior requires migration apply in a later phase.
- Local uncommitted `routeTree.gen.ts` dirt remains (not part of PR).

---

## 13. المرحلة التالية المقترحة

**PHASE-9.2-ACADEMIC-DELIVERY-MODEL-V2-IMPORT-GENERATOR-PR-REREVIEW-01**
