#!/usr/bin/env bash
set -euo pipefail

# Logical restore drill for the application-owned public schema only.
# This never replaces Supabase managed backups or PITR.

PRODUCTION_PROJECT_REF="emzytxqkxjjhsivqxdiu"

fail() {
  printf 'backup-restore-drill: %s\n' "$1" >&2
  exit 1
}

[[ "${RESTORE_DRILL_ACK:-}" == "DISPOSABLE_ONLY" ]] || fail "RESTORE_DRILL_ACK must be DISPOSABLE_ONLY"
[[ -n "${SOURCE_DATABASE_URL:-}" ]] || fail "SOURCE_DATABASE_URL is required"
[[ -n "${RESTORE_DATABASE_URL:-}" ]] || fail "RESTORE_DATABASE_URL is required"
[[ "$SOURCE_DATABASE_URL" != "$RESTORE_DATABASE_URL" ]] || fail "source and restore targets must differ"
[[ "${RESTORE_TARGET_LABEL:-}" == disposable-* ]] || fail "RESTORE_TARGET_LABEL must start with disposable-"

case "$RESTORE_DATABASE_URL" in
  *"$PRODUCTION_PROJECT_REF"*) fail "production project cannot be a restore target" ;;
esac

for command_name in pg_dump pg_restore psql; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

target_database="$({ RESTORE_DATABASE_URL="$RESTORE_DATABASE_URL" psql "$RESTORE_DATABASE_URL" -X -Atqc 'select current_database()'; } 2>/dev/null)"
[[ "$target_database" == restore_drill_* ]] || fail "target database name must start with restore_drill_"

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
dump_file="$work_dir/public-schema.dump"

pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  --schema=public \
  --no-owner \
  --no-acl \
  --file="$dump_file"

pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$dump_file"

source_tables="$(psql "$SOURCE_DATABASE_URL" -X -Atqc "select count(*) from pg_tables where schemaname = 'public'")"
restored_tables="$(psql "$RESTORE_DATABASE_URL" -X -Atqc "select count(*) from pg_tables where schemaname = 'public'")"
[[ "$source_tables" == "$restored_tables" ]] || fail "public table count mismatch: source=$source_tables restored=$restored_tables"

source_migrations="$(psql "$SOURCE_DATABASE_URL" -X -Atqc "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null || true)"
restored_migrations="$(psql "$RESTORE_DATABASE_URL" -X -Atqc "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null || true)"

printf 'RESTORE_DRILL_PASS target=%s public_tables=%s source_migrations=%s restored_migrations=%s\n' \
  "$RESTORE_TARGET_LABEL" "$restored_tables" "${source_migrations:-unavailable}" "${restored_migrations:-unavailable}"
