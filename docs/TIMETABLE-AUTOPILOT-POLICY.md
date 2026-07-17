# Timetable Autopilot Policy

## Binding academic operating model

1. The approved study plan is the official source for every course assigned to a cohort.
2. Every student in a cohort follows the plan courses for the cohort's level and semester; the timetable system does not offer free individual registration for core courses.
3. Electives enter cohort curriculum only through an approved academic cohort-level selection.
4. `academic_cohort` is the primary student context in the new operating model.
5. The new operating model has no section concept. `delivery_groups` are used only to split delivery of a course component because of capacity or delivery nature.
6. `sections` and `course_offering_sections` remain Legacy-compatibility structures only; they must not be deleted or migrated destructively without a separately approved plan.
7. No new feature may depend on `section_id` unless the compatibility need is documented and the new cohort/delivery-group path remains authoritative.
8. New curriculum flow is: approved study plan -> cohort curriculum -> approved cohort electives -> delivery groups when a teaching split is required.
9. Legacy adapters must fail closed and must not make sections authoritative for new flows.
10. `regular` and `parallel` remain strictly isolated in curriculum, cohorts, delivery groups, scheduling, conflicts, reports, imports, and all database predicates.

- Discover current Git, worktree, PR, CI, migration and test state before acting.
- Preserve dirty or owner-unknown worktrees; isolate new work in a dedicated branch/worktree.
- Continue independent safe work when one path is blocked.
- Keep regular and parallel programs and every college tenant strictly isolated.
- Require tests, build, lint/baseline documentation, `git diff --check`, and independent review for security/runtime/migration changes.
- Do not apply migrations, execute production SQL, deploy, publish, change secrets, force-push, or mutate academic production data without new explicit user approval.
- Keep source-only migration work fail-closed and clearly labeled.
- Never merge with critical/high security findings, failed gates, or unverified tenant isolation.
- Update the state, decisions, and log files at the end of each orchestration cycle.
