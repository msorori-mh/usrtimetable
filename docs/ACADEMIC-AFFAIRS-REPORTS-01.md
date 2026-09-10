# Academic affairs account and reports

Decision: **HOLD for activation**. The source changes pass local checks. No real account has been created and this branch has not been published.

Baseline: `msorori-mh/usrtimetable`, `main` at `9b150b32ac1942f28031c90fa821fafd79faa848`.

## Delivered source

- An institution-admin-only account creation preset named `إدارة الشؤون الأكاديمية`, using the existing `institutional_viewer` role. The preset fixes the role to read-only and does not require individual college assignments. It does not change existing role definitions or grant write privileges.
- `/reports/academic-affairs`: printable/exportable teaching assignments, delivery-group assignment shortages, and faculty load/excess/deficit reports. Filters cover college, term, department, program, instructor and load status. Filter scope is printed in the report header.
- Faculty load comes from the existing authenticated `compute_instructor_standard_workload` RPC; assignments and shortages come from `list_teaching_assignment_workspace`. There are no new RPCs, migrations or database writes.
- Project supervision remains separate. Missing workload policies render unknown compliance values rather than zeros. Program filtering preserves an instructor's full college/term load. Unassigned faculty with a known load show the entire required load as their deficit.
- The existing scheduled-hours report is restricted to one schedule version and excludes split parent sessions, with paginated session reads. It is explicitly distinct from the policy-based assignment report.
- CI runs the new report calculation tests.

## Verified

- `node --import tsx --test tests/academic-affairs.test.ts`: **12 passed, 0 failed**.
- `tsc --noEmit --pretty false`: **passed**.
- Scoped ESLint for changed application files and the new test: **passed**.
- `vite build`: **passed**, including client, SSR and Nitro output. Existing chunk-size and server-function deprecation warnings remain.
- `git diff --check`: **passed**.

The local dependency installation was reconciled to the upstream `bun.lock` versions for verification. `package.json` and the upstream lockfile are unchanged in the patch.

## Live read-only findings and activation requirements

- Live `can_view_college` includes `institutional_viewer`; `can_manage_college` does not. The `is_institutional_read_only_actor` helper and exclusions on profile/audit write policies are already applied, despite the older source-only document saying they were pending.
- No account currently has `institutional_viewer`. The user must identify the official account email before account creation; no email or password was invented.
- `faculty_workload_policies` contains **0 rows**. Policy-based excess/deficit cannot be certified until the institution supplies and configures its approved policy. This patch deliberately does not substitute maximum weekly scheduling hours for an official faculty load policy.
- Initial reads showed 8 colleges, 73 teaching assignments, 2 schedule versions. The final read showed 8 colleges, 478 teaching assignments, 2 schedule versions. This task issued SELECT queries only. The assignment count changed independently during the task, so unchanged live data counts are **not** claimed; refresh the baseline before any later write or activation.
- No authenticated institutional-viewer session, live negative-write test, or live account-creation flow was exercised. Those checks remain required after the actual account is identified and created.
- Native PDF/Excel visual acceptance remains **open**. The local browser binaries were absent; browser installation failed with a filesystem-lock error and a direct download timed out. A mock preview was prepared locally, but no browser screenshot or downloaded output is claimed as verified.

Rollback: revert this source commit. No database rollback is required because the task made no database changes.
