#!/usr/bin/env bash
set -euo pipefail

# Logical restore drill (M-27). Dumps every application schema (public and the *_private
# schemas; Supabase platform schemas excluded), the migration history and, optionally,
# the Supabase auth schema from SOURCE_DATABASE_URL, restores them into a DISPOSABLE
# database, compares the row count of every table, and writes a secret-free evidence
# file under docs/operations/drills/.
#
# This never replaces Supabase managed backups or PITR; it proves that a logical dump can
# be restored and that nothing is silently lost. See docs/operations/supabase-backup-restore.md.
#
# Required environment:
#   RESTORE_DRILL_ACK=DISPOSABLE_ONLY
#   RESTORE_TARGET_LABEL=disposable-<something>
#   SOURCE_DATABASE_URL=postgresql://…           (read access is enough)
#   RESTORE_DATABASE_URL=postgresql://…/restore_drill_<something>
# Optional:
#   INCLUDE_AUTH=1        also dump/restore the auth schema (see caveats in the runbook)
#   EVIDENCE_DIR=<dir>    where to write the evidence file (default docs/operations/drills)
#   DRILL_NO_EVIDENCE=1   do not write an evidence file (CI smoke runs)

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"

fail() {
  printf 'backup-restore-drill: %s\n' "$1" >&2
  exit 1
}

[[ "${RESTORE_DRILL_ACK:-}" == "DISPOSABLE_ONLY" ]] || fail "RESTORE_DRILL_ACK must be DISPOSABLE_ONLY"
[[ -n "${SOURCE_DATABASE_URL:-}" ]] || fail "SOURCE_DATABASE_URL is required"
[[ -n "${RESTORE_DATABASE_URL:-}" ]] || fail "RESTORE_DATABASE_URL is required"
[[ "$SOURCE_DATABASE_URL" != "$RESTORE_DATABASE_URL" ]] || fail "source and restore targets must differ"
[[ "${RESTORE_TARGET_LABEL:-}" == disposable-* ]] || fail "RESTORE_TARGET_LABEL must start with disposable-"

# The production project ref is read from supabase/config.toml (never hard-coded here).
production_ref="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$repo_root/supabase/config.toml" | head -n1)"
[[ -n "$production_ref" ]] || fail "cannot read project_id from supabase/config.toml"
case "$RESTORE_DATABASE_URL" in
  *"$production_ref"*) fail "production project cannot be a restore target" ;;
esac

for command_name in pg_dump pg_restore psql; do
  command -v "$command_name" >/dev/null 2>&1 || fail "$command_name is required"
done

target_database="$(psql "$RESTORE_DATABASE_URL" -X -Atqc 'select current_database()' 2>/dev/null || true)"
[[ "$target_database" == restore_drill_* ]] || fail "target database name must start with restore_drill_"

# Schemas managed by the Supabase platform are never part of the application dump.
# Everything else (public + every *_private schema the migrations create) is.
platform_schemas="'auth','storage','extensions','graphql','graphql_public','realtime','_realtime','supabase_functions','supabase_migrations','vault','pgsodium','pgsodium_masks','net','cron','pgbouncer','_analytics','information_schema'"
mapfile -t schemas < <(psql "$SOURCE_DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 -c "
  select nspname from pg_namespace
  where nspname not like 'pg\_%' and nspname not in ($platform_schemas)
  order by nspname = 'public' desc, nspname")
[[ " ${schemas[*]} " == *" public "* ]] || fail "source has no public schema"
if [[ "${INCLUDE_AUTH:-0}" == "1" ]]; then
  # auth.users is referenced by public tables; restore it in the same pg_restore run.
  schemas=(auth "${schemas[@]}")
fi
if psql "$SOURCE_DATABASE_URL" -X -Atqc "select 1 from pg_namespace where nspname = 'supabase_migrations'" | grep -q 1; then
  schemas+=(supabase_migrations)
fi
schema_list="$(IFS=,; echo "${schemas[*]}")"
schema_array_sql="'{$schema_list}'::text[]"
schema_args=()
for schema in "${schemas[@]}"; do schema_args+=("--schema=$schema"); done

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
start_epoch="$(date -u +%s)"

# A schema-filtered dump does not carry CREATE EXTENSION. Recreate every source extension
# (same schema) in the target first, otherwise e.g. btree_gist exclusion constraints fail.
psql "$SOURCE_DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 -c "
  select format('create schema if not exists %I; create extension if not exists %I with schema %I;',
                n.nspname, e.extname, n.nspname)
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname <> 'plpgsql' order by e.extname" > "$work_dir/extensions.sql"

# One dump for all schemas so cross-schema dependencies restore in the right order.
pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom \
  "${schema_args[@]}" \
  --no-owner \
  --no-acl \
  --file="$work_dir/app.dump"
dumped_epoch="$(date -u +%s)"

# The target must be an EMPTY disposable database: nothing is dropped or overwritten.
existing_tables="$(psql "$RESTORE_DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 -c "
  select count(*) from information_schema.tables
  where table_type = 'BASE TABLE' and table_schema = any($schema_array_sql)")"
[[ "$existing_tables" == "0" ]] || fail "restore target is not empty ($existing_tables tables in $schema_list)"

psql "$RESTORE_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "set client_min_messages = warning" -f "$work_dir/extensions.sql"
# "public" (and any pre-created schema) already exists in a fresh database; skip those
# CREATE SCHEMA entries instead of using --clean, which would try to DROP them.
pg_restore --list "$work_dir/app.dump" > "$work_dir/app.list"
existing_schemas="$(psql "$RESTORE_DATABASE_URL" -X -Atq -c "select string_agg(nspname, ' ') from pg_namespace")"
for schema in $existing_schemas; do
  sed -i "/ SCHEMA - $schema /d" "$work_dir/app.list"
done
pg_restore \
  --dbname="$RESTORE_DATABASE_URL" \
  --use-list="$work_dir/app.list" \
  --no-owner \
  --no-acl \
  --exit-on-error \
  "$work_dir/app.dump"
restored_epoch="$(date -u +%s)"

# Exact per-table row counts (base tables only), one "schema.table<TAB>count" line each.
count_sql="
select format('%I.%I', table_schema, table_name) || chr(9) ||
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text
from information_schema.tables
where table_type = 'BASE TABLE' and table_schema = any($schema_array_sql)
order by 1"

psql "$SOURCE_DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 -c "$count_sql" > "$work_dir/source.counts"
psql "$RESTORE_DATABASE_URL" -X -Atq -v ON_ERROR_STOP=1 -c "$count_sql" > "$work_dir/restored.counts"

if ! diff -u "$work_dir/source.counts" "$work_dir/restored.counts" > "$work_dir/counts.diff"; then
  cat "$work_dir/counts.diff" >&2
  fail "per-table row count mismatch (schema/table names above; no data shown)"
fi

table_count="$(wc -l < "$work_dir/restored.counts" | tr -d ' ')"
total_rows="$(awk -F '\t' '{ s += $2 } END { print s + 0 }' "$work_dir/restored.counts")"
[[ "$table_count" -gt 0 ]] || fail "no tables found in schemas: $schema_list"

source_migrations="$(psql "$SOURCE_DATABASE_URL" -X -Atqc "select count(*) from supabase_migrations.schema_migrations" 2>/dev/null || true)"
finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
dump_seconds=$((dumped_epoch - start_epoch))
restore_seconds=$((restored_epoch - dumped_epoch))
total_seconds=$(( $(date -u +%s) - start_epoch ))

summary="RESTORE_DRILL_PASS target=$RESTORE_TARGET_LABEL schemas=$schema_list tables=$table_count rows=$total_rows source_migrations=${source_migrations:-unavailable} dump_s=$dump_seconds restore_s=$restore_seconds total_s=$total_seconds"
printf '%s\n' "$summary"

if [[ "${DRILL_NO_EVIDENCE:-0}" != "1" ]]; then
  evidence_dir="${EVIDENCE_DIR:-$repo_root/docs/operations/drills}"
  mkdir -p "$evidence_dir"
  evidence_file="$evidence_dir/restore-drill-$(date -u +%Y%m%dT%H%M%SZ).txt"
  # Evidence holds labels, counts and timings only — never URLs, hosts, users or data.
  {
    printf '%s\n' "$summary"
    printf 'started_at=%s\nfinished_at=%s\n' "$started_at" "$finished_at"
    printf 'git_commit=%s\n' "$(git -C "$repo_root" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    printf '\n# per-table row counts (identical in source and restore)\n'
    cat "$work_dir/restored.counts"
  } > "$evidence_file"
  printf 'evidence: %s\n' "${evidence_file#"$repo_root"/}"
fi
