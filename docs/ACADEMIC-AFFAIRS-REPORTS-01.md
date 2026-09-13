# Academic affairs account and reports

Stage: **ACADEMIC-AFFAIRS-REPORTS-01 — infrastructure**.
Decision: **PASS for source implementation and local verification**. Creating a real account and entering academic details are administrator setup steps, not prerequisites for delivering this infrastructure. This document does not claim a production deployment or a live account test.

Baseline: `msorori-mh/usrtimetable`, updated through `main` at `68fc82118cfd314c4d53750a1a8a43c4ae6cdffa`. The integration preserves the guided data-preparation workflow and the recent program-filtering and printing changes.

## Administrator setup, when needed

1. Open **إدارة المستخدمين** and choose **إنشاء حساب الشؤون الأكاديمية**.
2. The administrator supplies the email, account name and temporary password. No email is hard-coded or requested from the project owner during infrastructure delivery.
3. The preset fixes the account to the existing `institutional_viewer` role, shown to users as **إدارة الشؤون الأكاديمية**. At least one college assignment is **mandatory**: the account reads reports for its assigned colleges only, and never for the whole institution. With several colleges assigned it switches between them through the existing active-college mechanism.
4. Academic data and approved workload policies can be entered later through the institution's administration processes. Missing policies leave required load, excess and deficit unknown; they do not prevent account creation or assignment reporting.

## Delivered source

- An institution-admin-only account creation preset named `إدارة الشؤون الأكاديمية`, reusing `institutional_viewer`. Existing role definitions, database policies and write permissions are unchanged; the role stays strictly read-only.
- Database scope narrowing: `public.can_view_college` no longer returns TRUE for `institutional_viewer` institution-wide; the role now passes only through `user_in_college`, i.e. its assigned colleges. This removes a read privilege and grants nothing. `can_manage_college`, `is_super_admin` and every write policy are untouched.
- Reports-only scope: the account reaches `/reports` and `/reports/*` only. Navigation shows the reports centre alone (no operational path, dashboard, tools centre, setup, data, scheduling, users, colleges, nor the navigation-mode toggle), the reports hub hides the publishing link that leaves `/reports`, and `ReportsOnlyGate` redirects any other path to `/reports` — hiding menu entries is not relied upon. College lists are filtered to `user_colleges`. Multi-role safety: an account that also holds `super_admin` or `college_admin` keeps that role's full behaviour.
- `/reports/academic-affairs`: printable/exportable teaching assignments, delivery-group assignment shortages, and faculty load/excess/deficit reports. Filters cover college, term, department, program, instructor and load status. Filter scope appears on screen and in print.
- Faculty load comes from the existing authenticated `compute_instructor_standard_workload` RPC; assignments and shortages come from `list_teaching_assignment_workspace`. There are no new RPCs, migrations or database writes in this patch.
- Project supervision remains separate. Program filtering preserves an instructor's full college/term load. An unassigned instructor with a known load shows the full required load as their deficit. Unspecified shared-teaching allocations remain unknown.
- Empty colleges show a deferred-data message. Changing college clears dependent filters and previous results. Failed requests cannot export partial numbers.
- The existing scheduled-hours report is restricted to one schedule version and excludes split parent sessions, with paginated session reads. It remains distinct from the policy-based assignment report.
- CI runs the new report calculation tests and `tests/academic-affairs-role.test.ts`, which proves the reports-only navigation surface, the `/dashboard` → `/reports` redirect, assigned-college scoping, the mandatory `college_ids` on creation, and the hidden `/published-schedules` link.

## Verification

- `node --import tsx --test tests/academic-affairs.test.ts`: **13 passed, 0 failed**, including an empty academic structure, shared teaching, missing policies, project hours, scope isolation and program filtering.
- `tsc --noEmit --pretty false`: **passed** on the integrated source.
- Scoped ESLint for changed application files and the new test: **passed**.
- `vite build`: **passed**, including client, SSR and Nitro output. Existing build warnings remain.
- `git diff --check`: **passed**.
- Chromium with the real React pages and mocked authentication/data boundaries: administrator-entered email, fixed institutional role, mandatory college assignment on submission, hidden create controls for the institutional viewer, all three reports, empty-college switching, failed-fetch export prevention, and mobile RTL without document overflow: **passed**. No real account was created by these tests.
- Native Excel and PDF downloads were produced from synthetic fixtures. Desktop and print screenshots were inspected. Excel values preserve known numbers and missing-policy blanks. These checks do not represent live university figures.

The local dependency installation was reconciled to the upstream `bun.lock` versions. `package.json` and the lockfile are unchanged. Browser tooling and synthetic outputs are local QA materials, outside the source patch.

## Production boundary

The existing institutional-viewer role and its read-only database controls were inspected in the earlier read-only preflight. No production data or account was changed by this work. At that preflight, approved workload policies had not yet been configured; this is deferred institution setup, not an infrastructure blocker. Production counts may change independently and are not used as a release assertion here.

A future production rollout should verify sign-in and reports with an account whose email the administrator chooses. No live authenticated session or live negative-write test is claimed by the local checks above.

Rollback: revert the source change. No database rollback is required.
