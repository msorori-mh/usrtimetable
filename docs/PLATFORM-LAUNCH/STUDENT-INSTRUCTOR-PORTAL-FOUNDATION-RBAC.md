# Student / Instructor Portal — Source Foundation RBAC Notes

Mission: `STUDENT-INSTRUCTOR-PORTAL-SOURCE-FOUNDATION-01`

## Current production roles

- `super_admin`
- `college_admin`
- `read_only`

There are **no** `student` or `instructor` values on `app_role`.

## Foundation PR scope

- Read-only stub pages under `/portal/student` and `/portal/instructor`.
- Design notes for day/week/session/changes/PDF.
- Mobile-first Arabic RTL placeholders.
- No admin controls on portal stubs.
- No production accounts created.
- No email-matching identity binding.

## Migration

**Not required** for this foundation PR.

A future role/identity migration (separate approval) would be needed before real self-service portal authz.
