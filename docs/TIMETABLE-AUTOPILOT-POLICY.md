# Timetable Autopilot Policy

- Discover current Git, worktree, PR, CI, migration and test state before acting.
- Preserve dirty or owner-unknown worktrees; isolate new work in a dedicated branch/worktree.
- Continue independent safe work when one path is blocked.
- Keep regular and parallel programs and every college tenant strictly isolated.
- Require tests, build, lint/baseline documentation, `git diff --check`, and independent review for security/runtime/migration changes.
- Do not apply migrations, execute production SQL, deploy, publish, change secrets, force-push, or mutate academic production data without new explicit user approval.
- Keep source-only migration work fail-closed and clearly labeled.
- Never merge with critical/high security findings, failed gates, or unverified tenant isolation.
- Update the state, decisions, and log files at the end of each orchestration cycle.
