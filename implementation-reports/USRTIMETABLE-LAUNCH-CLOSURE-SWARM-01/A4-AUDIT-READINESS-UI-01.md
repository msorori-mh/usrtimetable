# A4-AUDIT-READINESS-UI-01 — Audit Viewer + Readiness Dashboard (source-only UI)

- **Swarm:** USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01 · Wave WAVE-04 · Agent AGENT-AUDIT-READINESS-A4
- **Branch:** `feat/a4-audit-readiness-ui` (from `main`) · **PR:** Draft, base `main`
- **Designs:** `A4-AUDIT-VIEWER-DESIGN-01.md`, `A4-READINESS-DASHBOARD-DESIGN-01.md`, `A4-AUTHORIZATION-MATRIX-01.md`
- **Scope:** UI source only. **No DB writes, no migration apply, no deploy.** Validation = static review only — runtime gates pending CI.

## 1. What was implemented

### 1.1 Audit Viewer — `/audit-logs` (READ-ONLY)
- `src/routes/_authenticated/audit-logs.tsx` + `src/lib/audit-logs/model.ts`.
- Keyset (cursor) pagination over `audit_logs` (`created_at DESC, id DESC`, `.lt("created_at", cursor)`, page size 50) — **no offset** (design §5: append-heavy table).
- Filters: date range (من/إلى), action (dropdown from known-action dictionary with Arabic labels), entity (free text), actor UUID (**super_admin only**).
- Before/after field-level **diff** (changed keys only) + full details behind `<details>`, with recursive **redaction** of sensitive keys matching `/token|secret|password|apikey|api_key|jwt/i` → `•••` (design §4.2). Sensitive fields are never rendered even inside the diff.
- RLS posture (design §4.4): **no college selector for non-super_admin** (selector = UX only; RLS is the boundary). college_admin/read_only are scoped by RLS to their college; super_admin gets the standard `CollegeSwitcher` (UX only).
- Actor names: batch `profiles` lookup; GAP-A2 → non-super_admin actors fall back to short-id (AUTO_SAFE); email shown only to super_admin.
- **No-write guarantee:** zero `insert/update/delete/upsert`, zero RPC, no audit-writer import. Verified by harness.

### 1.2 Readiness Dashboard — `/readiness-dashboard` (READ-ONLY)
- `src/routes/_authenticated/readiness-dashboard.tsx` + `src/lib/readiness/checks.ts`.
- 15 checks (B1–B15), each: status `PASS | BLOCKED | UNKNOWN`, severity (`BLOCKER/WARN`), read-only SELECT under caller RLS, and an **exact next step** (verb + owning route) in official Arabic terminology.
- **Fail-closed:** any table/column gap (e.g. source-only migrations not applied) degrades the check to `UNKNOWN` ("غير متاح") — never a silent pass. B4 follows the PR #62 pattern (UI for unapplied headcount with readiness blocker).
- Three lanes: (1) مسلسل الإطلاق — workflow rail in locked order; (2) الجاهزية التفصيلية — link to existing `/data-readiness` (reused unchanged, no logic duplication); (3) حواجز النظام والترحيل — B11 migration manifest + B15 legacy residue, both read-only mirrors of `STATE.json`.
- `read_only` users see next-step CTAs disabled with an explicit hint ("يتطلب صلاحية إدارة") — UX only; RLS/RPC remains the boundary.
- Overall status = worst BLOCKER state (fail-closed, not an averaged score).
- A2 lock surfaced: "المجموعات المشتركة للمحاضرات غير مفعّلة بعد — لا دمج افتراضيًا".

### 1.3 Checks inventory (design mapping)
| ID | Check | Source (read-only) | Next step |
|----|-------|--------------------|-----------|
| B1 | الفصل الدراسي النشط | `academic_terms` (is_active) | `/terms` |
| B2 | الأقسام والبرامج | `departments`, `academic_programs` | `/departments` |
| B3 | الدفعات الدراسية | `academic_cohorts` (active) | `/academic-cohorts` |
| B5 | منهج الدفعة | `academic_cohorts.plan_id` + `plan_courses` (fail-closed probe) | `/academic-cohorts` |
| B6 | مجموعات المحاضرات والمعامل | `delivery_groups` per active cohort | `/academic-cohorts` |
| B7 | الإسناد التدريسي | `teaching_assignments` coverage/instructor_id | `/teaching-assignments` |
| B8 | القاعات | `rooms` type+capacity | `/rooms` |
| B14 | أيام وفترات الدوام | `scheduling_settings.working_days` + `time_slot_templates` | `/scheduling-settings` |
| B13 | توفر المحاضرين الخارجيين | `instructors` (categorized) − `instructor_availability` | `/availability` |
| B4 | أعداد الدفعات المعتمدة للجدولة | `scheduling_cohort_term_headcounts` (approved) — **UNKNOWN pre-apply** | `/scheduling-headcounts` |
| B9 | السعة مقابل الأعداد | `delivery_groups.expected_students` vs max `rooms.capacity` | `/delivery-groups` |
| B10 | التعارضات الإلزامية | latest `schedule_quality_runs.hard_conflicts_count` | `/conflict-checks` |
| B12 | دورة حياة النسخ | `schedule_versions` status summary (WARN) | `/schedule-versions` |
| B11 | حواجز الترحيل | static mirror of STATE.json manifest (UNKNOWN/HELD) | APPROVE_DB_MIGRATION_APPLY |
| B15 | بقايا Legacy | static mirror (174 + 5, USER_CONFIRMED_PRODUCTION_FACT) | APPROVE_LEGACY_DATA_REMEDIATION |

### 1.4 Routing & navigation
- `src/routeTree.gen.ts` updated (house style: file is committed; PR #62 precedent for hand-maintained entries). Uploaded content verified byte-identical to local generation (git blob SHA match).
- `src/components/app-layout.tsx`: NAV entries "جاهزية الإطلاق" (ungrouped, after جاهزية البيانات) and "سجل التدقيق" (group التقارير) — both `roles: ALL` (visibility ≠ authorization).

### 1.5 Harness
- `tests/harness/audit-readiness-ui.harness.ts` (10 groups): route registration in routeTree + NAV; **no DML/RPC/audit-writer** in the 4 new files; keyset-only pagination (no `.range(`); redaction pattern; super_admin-only college selector; **no Legacy access** (`sections`, `course_offering_sections`, `section_groups`, `section_id` filters, "مجموعات التدريس"); all 7 mandated terms present; all 15 check IDs registered; B11 manifest tokens; fail-closed headcount link.
- Registered in `tests/harness/run.mjs` at the alphabetical slot (before `availability-all-active-days.harness.ts`). Note: the existing list is historically append-ordered; the task explicitly requested alphabetical registration.

## 2. Validation evidence (static only)
- Harness executed locally (tsx) against the **exact branch bytes** (every file verified by git blob SHA before running): `{"harness":"audit-readiness-ui","status":"pass"}` — exit 0.
- All 7 new/modified files pass `tsc` **syntax** transpile check (React JSX, ES2022) — no full project typecheck locally (deps not installed); runtime gates pending CI.
- No writes to `main`; no rebase; no force-push; file-by-file `create_or_update_file`.

## 3. Deviations from design (documented)
1. **Lane 2** implemented as a link to `/data-readiness` + `/reports/data-readiness` instead of duplicated score cards — reuses the existing implementation unchanged and avoids logic drift.
2. **Global audit rows** (`college_id IS NULL`) are not displayed in V1: the viewer always scopes to the active college (RLS would allow them for super_admin). Known limitation, safe direction.
3. **B5** probes `academic_cohorts.plan_id`; **B9** probes `delivery_groups.expected_students`. If either column name differs at runtime, the check degrades to UNKNOWN (fail-closed) — schema could not be verified statically (UNKNOWN).
4. **B10** uses `schedule_quality_runs` only; pending conflict-exception counts (design optional) not queried in V1 to avoid an unverified table dependency — noted as follow-up.
5. **Actor names (GAP-A2):** option (a) — non-super_admin sees own/short-id only (profiles RLS = self + super_admin). Dictionary-driven name resolution for college_admin deferred.
6. **Keyset cursor** uses `created_at` only (matches the design sketch); rows sharing the exact cursor timestamp across a page boundary could be skipped — accepted per design sketch; tie-breaker can be added later without schema change.
7. **B11/B15** are static mirrors of STATE.json (UNKNOWN/HELD) — remote apply-state is unverifiable by design ("لا يُعتد بأي ترحيل كمطبَّق دون دليل عن بُعد").
8. **Entity deep-links** in the audit viewer skipped in V1 (design: "when known"); entity shown as name + short id.

## 4. UNKNOWNs / BLOCKERs
- UNKNOWN: full `tsc`/build/CI result (not runnable locally) — syntax + harness verified only.
- UNKNOWN: runtime column presence for B1 (`academic_terms.is_active`), B5 (`plan_id`), B9 (`expected_students`) — all fail-closed to UNKNOWN if absent.
- UNKNOWN: actual migration apply-state on production (mirrored as UNKNOWN/HELD, per gate discipline).
- BLOCKER (pre-existing, surfaced not created): 20260721180000 (headcount), 20260717050000 (cross-college hardening), 20260715120000 (capacity split), 20260718183000 (cohort curriculum runtime), 20260720120000 (availability all active days), 20260720143000 (program-department integrity) — all await APPROVE_DB_MIGRATION_APPLY; 20260721090000 HELD pending A1.3b (APPROVE_LEGACY_DATA_REMEDIATION).

## 5. Files
- `src/routes/_authenticated/audit-logs.tsx` (new)
- `src/lib/audit-logs/model.ts` (new)
- `src/routes/_authenticated/readiness-dashboard.tsx` (new)
- `src/lib/readiness/checks.ts` (new)
- `src/routeTree.gen.ts` (updated — 2 routes)
- `src/components/app-layout.tsx` (updated — 2 NAV entries, 2 icons)
- `tests/harness/audit-readiness-ui.harness.ts` (new)
- `tests/harness/run.mjs` (updated — registration)
- `implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/A4-AUDIT-READINESS-UI-01.md` (this file)
