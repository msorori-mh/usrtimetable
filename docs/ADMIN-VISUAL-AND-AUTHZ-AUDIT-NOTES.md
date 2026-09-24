# Admin Visual, Authorization, and Gap Audit Notes

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`

## G8 — Role and authorization

### Role matrix (nav visibility)

| Area | super_admin | college_admin | read_only |
| --- | --- | --- | --- |
| Universities / colleges / users | Yes | Hidden (redirect/unauthorized) | Hidden |
| My college | No (uses system pages) | Yes | Yes |
| Academic / resources / settings / schedule / reports | Yes | Yes | Yes (read UX) |
| Data cleanup / import / auto-schedule | Yes | Yes | Hidden nav |
| Writes | canManage | canManage active college | Disabled in UI |

### Findings

| ID | Finding | Severity |
| --- | --- | --- |
| AUTH-01 | Most routes are URL-reachable without page-level denial; sidebar hide ≠ authorization | HIGH |
| AUTH-02 | Relying on RLS is correct backend posture, but destructive buttons may still render before failing | MEDIUM |
| AUTH-03 | College isolation via `active-college-store` + RLS — good; composite FK harden still source-only remotely | HIGH (runtime) |
| AUTH-04 | regular/parallel isolation enforced in cohort/import/report paths — verify on every new screen | MEDIUM |
| AUTH-05 | No evidence of browser-only AuthZ for super_admin pages (universities/colleges/users have checks) | OK |
| AUTH-06 | Global settings editable by college_admin where college-scoped — OK; watch constraint_types global catalog | LOW |
| AUTH-07 | read_only sees Legacy sections and noisy setup pages with little operational value | UX / HIGH |

### Destructive ops

Delete exists on many CRUD pages (departments, programs, courses, sections, rooms, …). Room/offering delete guards exist in lib; not all entities have equivalent UX confirmations depth.

---

## G9 — Local runtime visual audit

| Item | Result |
| --- | --- |
| `node_modules` at freeze | Absent; `npm ci` failed (no lockfile); `npm install` attempted for quality gates |
| Browser MCP | Unavailable in this agent environment |
| Screenshots directory | `C:\projects\usrtimetable-system-audit-screenshots` (created; outside Git) |
| Mutations | None |
| Visual method | Static route/component contract review + prior execution-state docs |

### Page-level visual notes (from source contracts)

| Page | Title/desc | Empty state | Ambiguity / issues |
| --- | --- | --- | --- |
| sections | «تقسيم المجموعات الدراسية» | Standard empty list | **Misnamed Legacy** |
| delivery-groups | مجموعات التدريس | Empty until generate | Read-only; generation elsewhere |
| academic-cohorts | الدفعات + generate buttons | Empty groups message | Best New Flow hub |
| time-slots vs templates | Both «وقت» | Both look valid | **False choice** |
| availability | Tabs + Hard/Soft select | Per-tab empty | Soft/Hard easy to miss |
| import vs data-templates vs import-templates | Three centers | Catalog crowded | Overload |
| course-offerings | Hidden diagnostic | — | OK hidden |
| reports hub | Cards incl. Legacy badge | — | Department Legacy still listed |
| teaching-assignments | V2 workspace | Empty until DG | Depends on prior generate |
| workload | **No page** | — | Gap |
| audit logs | **No page** | — | Gap |

### Screenshot index

| Path | Status |
| --- | --- |
| `C:\projects\usrtimetable-system-audit-screenshots\INDEX.md` | To be filled when local authenticated session available |
| Capture policy | Read-only navigation only; no create/edit/delete/import/publish |

---

## G10 — Gap register

| ID | Gap | Severity |
| --- | --- | --- |
| GAP-01 | Legacy sections visible as study groups | BLOCKER |
| GAP-02 | Unclear post-cohort journey despite generate buttons | HIGH |
| GAP-03 | Curriculum generation easy to miss among nav noise | HIGH |
| GAP-04 | Cohort vs group vs section terminology collision | BLOCKER |
| GAP-05 | Delivery groups screen not framed as generated teaching split | HIGH |
| GAP-06 | Assignment→session relationship unclear outside builder | HIGH |
| GAP-07 | Realistic availability UX incomplete (mixed Hard/Soft) | HIGH |
| GAP-08 | Hard vs Soft not first-class IA | HIGH |
| GAP-09 | Schedule readiness indicators fragmented | MEDIUM |
| GAP-10 | Approval/publish checklist missing | HIGH |
| GAP-11 | Next-step messages sparse outside cohort summaries | MEDIUM |
| GAP-12 | Workload policies unmanaged in UI | BLOCKER |
| GAP-13 | Low-value / non-atomic catalog templates shown | HIGH |
| GAP-14 | Legacy pages/reports still user-visible | BLOCKER |
| GAP-15 | Unsafe/unclear deletes on foundational entities | MEDIUM |
| GAP-16 | Audit logs not viewable | MEDIUM |
| GAP-17 | Elective approval UI weak | HIGH |
| GAP-18 | Competing time_slots grid | BLOCKER |
| GAP-19 | Remote migrations/runtime unproven | BLOCKER |
| GAP-20 | Program without department | **Not a gap** — enforced |

### Severity totals (gaps + major dups/auth)

| Severity | Approx count |
| --- | ---: |
| BLOCKER | 8 |
| HIGH | 14 |
| MEDIUM | 10 |
| LOW | 2 |
| UX | 5 |
| LEGACY_DEBT | 3 |
