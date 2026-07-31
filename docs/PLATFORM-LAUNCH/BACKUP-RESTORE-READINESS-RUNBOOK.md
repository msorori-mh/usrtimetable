# Backup & Restore Readiness Runbook

Mission: `SYSTEM-HEALTH-BACKUP-READINESS-01`
Mode: **design / readiness only** — do **not** execute production backup/restore from this package.

## Export package (planned)

1. Schedule versions metadata (status, term, college, notes markers).
2. `schedule_sessions` for selected versions (CSV/JSON export via approved admin path).
3. Teaching assignments V2 + delivery groups (college-scoped).
4. Academic structure snapshots needed for restore verification.
5. Delivery demo package checksums from `docs/PLATFORM-LAUNCH`.

## Restore verification (planned)

1. Restore into isolated TEST classification only (never overwrite OPERATIONAL without approval).
2. Compare session checksum for protected demo version if present.
3. RBAC smoke: super_admin / college_admin / read_only.
4. Confirm demo warning still visible on demo versions.
5. Confirm no service_role / connection string leakage in UI.

## Explicit non-goals for this overnight package

- No production backup execution.
- No restore on `emzytxqkxjjhsivqxdiu`.
- No migration apply.
- No secrets displayed in System Health UI.
