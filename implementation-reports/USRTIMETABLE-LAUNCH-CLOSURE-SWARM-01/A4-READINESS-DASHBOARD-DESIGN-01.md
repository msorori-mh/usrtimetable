# A4 — READINESS DASHBOARD DESIGN 01 (TRACK 7)

**Swarm:** USRTIMETABLE-AUTONOMOUS-SOURCE-CLOSURE-WAVE-03 · **Baseline:** `b6a5a491f9f70f1cfba5dc5696fb33f64dbcee6b`
**Type:** design only. 100% read-only checks. No DB writes, no migration apply.

---

## 1. Purpose

A single **Readiness Dashboard** per college answering: "what exactly blocks us from building, approving, and publishing a real timetable — and what is the exact next step?" It extends (does not replace) the existing read-only `/data-readiness` route (`src/routes/_authenticated/data-readiness.tsx`, A1.5 new-flow metrics) and `/reports.data-readiness`, adding: term/program/cohort/headcount/curriculum/delivery-group/assignment/room/capacity/conflict/lifecycle blockers, **migration & runtime blockers**, and an **exact next step** per blocker following the locked target workflow (plan → cohort → electives → cohort courses → optional shared groups → delivery groups → teaching assignment → working days/slots → availability → build → review/approve/publish — `SYSTEM-AUDIT-DELTA-REFRESH-TERMINOLOGY-AND-SHARED-DELIVERY-LOCK-01.md`).

## 2. Design rules

1. **Read-only:** every check is a SELECT (or a read-only RPC such as `resolve_scheduling_headcount`). The dashboard itself never writes; "next step" links navigate to the owning screen.
2. **Fail-closed:** any schema gap (table/column missing pre-migration-apply) degrades that check to an explicit "NOT AVAILABLE — migration pending" blocker rather than silently passing. (Same pattern as `fetchNewFlowMetrics` in the existing route.)
3. **RLS-native:** queries run under the caller's RLS; college_admin/read_only see their college; super_admin picks a college. No new authorization surface.
4. **One exact next step per blocker** — a verb + route, not generic advice.

## 3. Blocker checks (ordered by workflow)

Severity: `BLOCKER` (publish/build impossible) · `WARN` (degraded quality) · `INFO`.

| # | Blocker | Check sketch (read-only) | Severity | Exact next step |
|---|---|---|---|---|
| B1 | Missing academic term | `academic_terms where college_id=? and is_active=true` → count = 0 | BLOCKER | "أنشئ الفصل الدراسي وفعّله" → `/terms` |
| B2 | Missing program/department | `departments` count = 0 OR `academic_programs` count = 0 (production fact: programs = 0, STATE.json) | BLOCKER | "أنشئ قسمًا ثم برنامجًا" → `/departments`, `/programs` |
| B3 | Missing cohorts | `academic_cohorts where college_id=? and active` count = 0 | BLOCKER | "أنشئ الدفعة الدراسية" → `/academic-cohorts` |
| B4 | Missing approved headcounts (fail-closed link to scheduling headcount) | per active cohort × active term: `resolve_scheduling_headcount` → `SCHEDULING_HEADCOUNT_MISSING`, or count `scheduling_cohort_term_headcounts status='approved'` vs active cohorts. If table missing → "migration 20260721180000 not applied" | BLOCKER | "أدخل واعتمد أعداد الطلبة لكل دفعة/فصل (مع المصدر)" → `/scheduling-headcounts`; if not applied: "طبّق سلسلة migrations (انظر B11)" |
| B5 | Missing curriculum | cohorts with 0 generated cohort courses / plan_courses for their plan (`generate_cohort_curriculum` output absent) | BLOCKER | "ولّد مقررات الدفعة من الخطة" → `/academic-cohorts` (generate action) |
| B6 | Missing delivery groups | active cohorts with no `delivery_groups` (existing metric, promoted to blocker) | BLOCKER | "ولّد مجموعات المحاضرات والمعامل" → `/academic-cohorts` (generate, can_manage only) |
| B7 | Missing teaching assignments | DGs without TA V2; TAs with `instructor_id IS NULL` (existing metrics) | BLOCKER | "أكمل الإسناد التدريسي وعيّن المحاضرين" → `/teaching-assignments` |
| B8 | Missing rooms | `rooms` count = 0; rooms without type; rooms capacity ≤ 0 (existing) | BLOCKER | "أضف القاعات وأنواعها وسعاتها" → `/rooms`, `/room-types` |
| B9 | Capacity blockers | per DG/session: `expected_students > max(room.capacity)` candidates; pending capacity-split proposals unapproved (`20260715120000`, source-only) | BLOCKER | "اعتمد تقسيم السعة أو وفّر قاعة أكبر" → `/delivery-groups` / capacity-split approval screen |
| B10 | Conflicts | latest `schedule_quality_runs.hard_conflicts_count > 0` OR unapproved hard conflicts from `conflict_checks`/move collector; count of `schedule_version_conflict_exceptions status='pending'` | BLOCKER (publish); WARN (draft) | "حل أو اعتمد استثناءات التعارض" → `/conflict-checks`, `/schedule-quality` |
| B11 | Migration/runtime blockers | static manifest from `STATE.json.source_only_migrations_not_applied` + expected apply order (`20260717050000` → `20260720143000` → `20260721180000` → approved headcounts → A2); per item status = UNKNOWN without remote evidence (rule: no migration counts as applied without remote proof). Include `20260721090000` (A1.3c) = intentionally HELD pending A1.3b | BLOCKER for headcount/A2 features | "اطلب APPROVE_DB_MIGRATION_APPLY وطبّق بالترتيب المعتمد" → link to `implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/SCHEDULING-HEADCOUNT-PRODUCTION-DEPENDENCY-MAP.md` |
| B12 | Lifecycle state | `schedule_versions` grouped by status for active term; none in draft+ → "ابدأ نسخة جدول"; draft stuck → next transition per matrix §6 | INFO/WARN | "أرسل للمراجعة / اعتمد / انشر وفق الصلاحيات" → `/schedule-versions` |
| B13 | Availability gaps | external / other-college instructors without availability (existing critical metric) | BLOCKER for scheduling those instructors | "أدخل أوقات توفر المحاضرين الخارجيين" → `/availability` |
| B14 | Working days/slots missing | `scheduling_settings` row absent or `working_days` empty; no active `time_slot_templates` per study system | BLOCKER | "عرّف أيام وفترات الدوام وقوالب الفترات" → `/scheduling-settings`, `/time-slot-templates` |
| B15 | Legacy residue | orphan counts (174 TA + 5 COS carrying section_id — production facts in STATE.json) still present; Legacy remediation pending | WARN (launch hygiene; becomes BLOCKER for A1.3c apply) | "أكمل تصنيف ومعالجة الأيتام (APPROVE_LEGACY_DATA_REMEDIATION)" → link to A1-3B plan doc |

### Query-per-check sketches (all read-only)

```sql
-- B1
select count(*) from academic_terms where college_id = :c and is_active;
-- B3/B6
select c.id from academic_cohorts c
 where c.college_id = :c and c.active
   and not exists (select 1 from delivery_groups dg where dg.cohort_id = c.id);
-- B4 (post-apply; else schema-probe → B11)
select count(*) filter (where status = 'approved') as approved, count(*) as total
  from scheduling_cohort_term_headcounts h
  join academic_cohorts c on c.id = h.cohort_id
 where h.college_id = :c and h.term_id = :active_term;
-- plus RPC: resolve_scheduling_headcount(cohort, term) → SCHEDULING_HEADCOUNT_MISSING (fail-closed)
-- B7
select count(*) from delivery_groups dg
 where dg.college_id = :c and not exists
   (select 1 from teaching_assignments ta where ta.delivery_group_id = dg.id and ta.instructor_id is not null);
-- B9
select dg.id, dg.expected_students from delivery_groups dg
 where dg.college_id = :c and dg.expected_students >
   (select max(r.capacity) from rooms r where r.college_id = :c and coalesce(r.is_active,true));
-- B10
select hard_conflicts_count from schedule_quality_runs
 where college_id = :c and schedule_version_id = :v order by created_at desc limit 1;
-- B14
select (working_days is null or cardinality(working_days)=0) as missing
  from scheduling_settings where college_id = :c;
```

*(In-app, these run as Supabase PostgREST selects under RLS, mirroring the existing `fetchReadiness` pattern; the SQL above documents intent.)*

## 4. UI layout

- **Header:** college switcher; active term chip (from B1); overall status = worst BLOCKER state (not an averaged score — blockers are fail-closed, not weighted).
- **Lane 1 — "مسلسل الإطلاق" (workflow rail):** B1→B3→B5→B6→B7→B8/B14/B13→B4→B9→B10→B12 rendered as a vertical checklist in locked workflow order; each row: status icon (✓/✗/⚠/غير متاح), count (`missing/total`), and a single **"الخطوة التالية بالضبط"** CTA linking to the owning route.
- **Lane 2 — "الجاهزية التفصيلية":** the existing score cards/metrics from `/data-readiness` reused unchanged (plan/resources/availability/scheduling).
- **Lane 3 — "حواجز النظام والترحيل":** B11 migration manifest table (file, order, status UNKNOWN/HELD/APPLIED-with-evidence, gate name) + B15 legacy residue counts. Read-only mirror of STATE.json facts; never claims "applied" without evidence.
- **Permissions:** dashboard visible to all roles (read-only). CTAs that require manage rights are *shown disabled with reason* for read_only (UX hint only; server RLS/RPC remains the boundary — see matrix §0.1).

## 5. AUTO_SAFE vs approval-gated

- **AUTO_SAFE (later implementation PR):** entire dashboard UI + all SELECT-based checks (B1–B3, B5–B10, B12–B15) against applied schema; fail-closed degradation for missing tables; B11 rendered from the checked-in STATE.json manifest.
- **Approval-gated (prerequisites, NOT part of dashboard):** migration applies that make B4/B9 fully live (`20260717050000`, `20260720143000`, `20260721180000`, then approved headcount data entry; `20260715120000` for split approvals) — all under `APPROVE_DB_MIGRATION_APPLY` per the dependency map; A1.3b/A1.3c under their named approvals.

## 6. Explicitly out of scope

- No auto-remediation actions from the dashboard.
- No headcount data entry from the dashboard (entry happens in `/scheduling-headcounts` via RPC only).
- No "applied" claims for source-only migrations without remote evidence.
