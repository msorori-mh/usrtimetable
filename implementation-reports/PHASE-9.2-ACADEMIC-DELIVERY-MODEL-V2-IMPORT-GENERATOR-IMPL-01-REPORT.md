# PHASE-9.2 Academic Delivery Model V2 — Import + Generator — Implementation Report 01

**Decision:** `PASS_WITH_NOTES`  
**Date:** 2026-07-16  
**Baseline SHA:** `8ef4226c06fbf5d45aca83212065f46f7c1de325`  
**Branch:** `feat/phase-9-2-academic-delivery-model-v2-import-generator`  
**Worktree:** `C:\projects\usrtimetable-phase-9-2`

---

## 1. Final decision

**PASS_WITH_NOTES**

- Repo-wide CRLF / prettier noise exists historically; **scoped Phase 9.2 files were converted LF + prettier-formatted** and are clean under scoped eslint.
- Migration file is **CREATED — NOT APPLIED**.
- **No DB writes**, no deploy, no publish, no PR merge during this implementation pass (PR create only after commit/push).

---

## 2. Baseline / branch

| Item | Value |
|------|--------|
| Baseline SHA | `8ef4226c06fbf5d45aca83212065f46f7c1de325` (Phase 9.1 V2 schema applied commit) |
| Branch | `feat/phase-9-2-academic-delivery-model-v2-import-generator` |
| Worktree | `C:\projects\usrtimetable-phase-9-2` |
| Mainline | **NOT TOUCHED** (`C:\projects\usrtimetable-mainline`) |

---

## 3. Modified / added files

### Added
- `src/lib/academic-delivery-v2/component-hours.ts`
- `src/lib/academic-delivery-v2/generator-plan.ts`
- `src/lib/academic-delivery-v2/group-count.ts`
- `src/lib/academic-delivery-v2/invoke-generator.ts`
- `src/lib/academic-delivery-v2/types.ts`
- `src/lib/schedule-builder/v2-compat.ts`
- `supabase/migrations/20260716070000_phase-9-2-academic-delivery-generator.sql`
- `tests/harness/academic-delivery-v2-generator.harness.ts`
- `implementation-reports/PHASE-9.2-ACADEMIC-DELIVERY-MODEL-V2-IMPORT-GENERATOR-IMPL-01-REPORT.md` (this report)

### Modified
- `src/components/app-layout.tsx`
- `src/integrations/supabase/types.ts`
- `src/lib/data-templates/catalog.ts`
- `src/lib/excel-import/commit.ts`
- `src/lib/excel-import/templates.ts`
- `src/lib/excel-import/types.ts`
- `src/lib/excel-import/validators.ts`
- `src/routes/_authenticated/course-offerings.tsx`
- `src/routes/_authenticated/import.tsx`
- `src/routeTree.gen.ts`
- `tests/harness/run.mjs`

### Explicitly excluded from commit
- `package-lock.json` (if untracked)
- `.wrangler/` deploy artifacts
- secrets / `.env`

---

## 4. Migration status

| File | Status |
|------|--------|
| `supabase/migrations/20260716070000_phase-9-2-academic-delivery-generator.sql` | **CREATED — NOT APPLIED** |

Contains RPC `public.generate_academic_delivery_for_cohorts(uuid, uuid[])`:
- Explicit cohort-scoped generator (not a trigger)
- Idempotent create/update of `delivery_groups` + compatibility `course_offerings`
- `REVOKE` from `PUBLIC`/`anon`; `GRANT EXECUTE` to `authenticated`, `service_role`

---

## 5. V2 generator details + idempotency

### Server (SQL RPC)
- **RPC:** `generate_academic_delivery_for_cohorts(p_college_id, p_cohort_ids)`
- **Idempotency:** lookup-then-update / insert pattern for delivery groups and compatibility offerings
- **Natural keys (from Phase 9.1 schema):**
  - `dg_unique` — `UNIQUE (component_id, cohort_id, group_code)` on `delivery_groups`
  - `co_unique` — unique expression index on `course_offerings` (college/term/course/program/level coalesce)

### Client / pure TS
- `planCohortDelivery` in `src/lib/academic-delivery-v2/generator-plan.ts` — pure planning (hours → groups → planned rows)
- Supporting: `component-hours.ts`, `group-count.ts`, `types.ts`, `invoke-generator.ts` (RPC invoke wrapper)

Harness: `tests/harness/academic-delivery-v2-generator.harness.ts` validates planning math / idempotent plan shape without DB.

---

## 6. Import changes (plans / cohorts / electives / assignments)

Excel import extended for V2 academic delivery entities:

- **Study plans** — plan courses with **component hours** (lecture/lab/tutorial etc.); validation via `parsePlanComponentHours` / approved component types
- **Academic cohorts** — cohort upsert + linkage
- **Electives** — elective slots / cohort elective selections
- **Teaching assignments** — assignment rows keyed toward delivery groups where applicable
- Templates / catalog updated (`excel-import/templates.ts`, `data-templates/catalog.ts`)
- Commit path (`excel-import/commit.ts`) + validators (`excel-import/validators.ts`) aligned

**Note:** plan imports that omit required component hours now **fail validation** (intentional V2 strictness).

---

## 7. How `course_offerings` was hidden

1. **Nav:** removed from operational nav in `app-layout.tsx` (comment: Phase 9.2 — internal auto-generated compat layer)
2. **Import UI:** course-offerings import entry removed from import surface (`import.tsx`)
3. **Page:** `course-offerings.tsx` reduced to a **read-only diagnostic** view of generated compatibility offerings (route retained for internal inspection)

---

## 8. Schedule Builder compatibility

- **Adapter only:** `src/lib/schedule-builder/v2-compat.ts`
- Prefers `delivery_group_code` when present; falls back to legacy `section_number`
- **No** changes to save / validate / move contracts in this phase

---

## 9. Verification results

| Check | Scope | Result |
|-------|--------|--------|
| Prettier (LF format) | Phase 9.2 paths listed in task | **PASS** (SQL: LF-normalized manually; prettier has no SQL parser) |
| ESLint | Same paths **excluding** SQL migration | **PASS** (`ESLINT_EXIT:0`) |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | **PASS** (`TSC_EXIT:0`) |
| Harness | `academic-delivery-v2-generator.harness.ts` | **PASS** |
| Full production build | — | **Not run** in this finalize pass |
| Repo-wide prettier/eslint | — | Known pre-existing CRLF noise → decision **PASS_WITH_NOTES** |
| Migration apply | — | **NOT APPLIED** |
| DB writes | — | **None** |

---

## 10. Risks / notes

1. **RPC will not work until migration is applied** in the target environment (explicit ops step; not done here).
2. **Old plan Excel imports without component hours** now fail validation — operators must use updated templates.
3. Compatibility `course_offerings` remain as a generated bridge; manual offerings path is de-emphasized but not fully cut over (see 9.5).
4. Schedule Builder still primarily legacy-shaped until Phase 9.3 dual-read.

---

## 11. Confirmations (safety)

| Action | Done? |
|--------|-------|
| DB writes | **No** |
| Migration apply | **No** |
| Deploy | **No** |
| Publish | **No** |
| PR merge | **No** |
| Touch mainline worktree | **No** |
| git stash / reset / clean | **No** |

---

## 12. Next phase (suggested only — NOT executed)

**PHASE-9.3** — Schedule Builder dual-read / load calculation using `delivery_groups` (and component hours), without changing save contracts until dual-read is proven.

---

## 13. Remaining phases (minimal logical set)

| Phase | Scope |
|-------|--------|
| **9.3** | SB dual-read + teaching load from components/groups |
| **9.4** | Elective slots admin UI + capacity policy UI (`strict_capacity`) |
| **9.5** | Cutover/deprecation of manual offerings path + data backfill ops |

---

## Security Review (required)

- **Files changed:** listed in §3
- **Did migrations change?** yes (file created, not applied)
- **Did RLS change?** no (generator migration focuses on RPC; relies on existing table RLS)
- **Did RPCs change?** yes (`generate_academic_delivery_for_cohorts` added in migration file)
- **Authentication impact:** no (uses existing authenticated session for RPC grant)
- **Authorization impact:** yes (EXECUTE granted to `authenticated` / `service_role`; revoked from anon/public — college scoping must be enforced inside RPC / RLS)
- **Sensitive data exposure:** no
- **Privilege escalation risk:** low (if RPC college scoping is correct; verify on apply)
- **Production risk:** low while migration unapplied; medium once applied until SB dual-read (9.3)
- **Ready for merge:** yes (code review + apply migration in controlled env)
- **Ready for deploy:** **no** until migration applied and smoke-tested in staging

---

## Recommended next step

1. Open/review PR (do not merge until reviewed).
2. Apply migration in **staging only** after approval.
3. Smoke-test RPC + import templates.
4. Start **PHASE-9.3** SB dual-read design.
