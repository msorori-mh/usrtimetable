#!/usr/bin/env bash
# M-7: capture the production schema as a reference baseline and diff it against the
# schema obtained by replaying the repository's migrations.
#
#   scripts/db/make-baseline.sh dump      # production → supabase/reference/prod-schema-<date>.sql
#   scripts/db/make-baseline.sh replay    # repository → supabase/reference/replay-schema-<date>.sql
#   scripts/db/make-baseline.sh diff [prod.sql] [replay.sql]
#   scripts/db/make-baseline.sh all       # dump + replay + diff
#
# dump:   needs PROD_DB_READONLY_URL (read-only role; `pg_dump --schema-only` only reads the
#         catalog) OR a linked Supabase CLI (`supabase db dump` is used when no URL is set).
#         Data is never dumped.
# replay: needs a disposable local PostgreSQL (PGHOST/PGPORT/PGUSER/PGPASSWORD) and uses
#         scripts/db/replay-migrations.sh into the database "baseline_replay".
# diff:   normalises both dumps (drops comments, SET lines, owners, grants to Supabase
#         internal roles, blank lines; sorts statements inside each object block) and writes
#         supabase/reference/schema-diff-<date>.txt. Exit 1 when they differ.
#
# This script never edits or deletes anything under supabase/migrations. The squash
# procedure that may follow is manual: docs/operations/migrations-baseline.md.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
ref_dir="$repo/supabase/reference"
stamp="${BASELINE_DATE:-$(date -u +%Y%m%d)}"
schemas=(public assignment_version_private education_source_revision_private faculty_private
  itcs_cutover_private provisioning_private schedule_coordination_private teaching_pay_private
  schedule_version_delivery_private jawf_term_source_private)
mkdir -p "$ref_dir"

schema_args() {
  local a=()
  for s in "${schemas[@]}"; do a+=("--schema=$s"); done
  printf '%s\n' "${a[@]}"
}

cmd_dump() {
  local out="$ref_dir/prod-schema-$stamp.sql"
  if [[ -n "${PROD_DB_READONLY_URL:-}" ]]; then
    mapfile -t args < <(schema_args)
    pg_dump "$PROD_DB_READONLY_URL" --schema-only --no-owner --no-privileges "${args[@]}" \
      --file="$out"
  elif command -v supabase >/dev/null 2>&1; then
    # Requires `supabase link` to the production project (read-only use).
    supabase db dump --schema "$(IFS=,; echo "${schemas[*]}")" --file "$out"
  else
    echo "set PROD_DB_READONLY_URL or install/link the Supabase CLI" >&2
    exit 2
  fi
  echo "production schema: ${out#"$repo"/}"
}

cmd_replay() {
  local out="$ref_dir/replay-schema-$stamp.sql"
  "$here/replay-migrations.sh" baseline_replay
  mapfile -t args < <(schema_args)
  # Missing schemas (failed historical migrations) are tolerated by pg_dump only if absent
  # from the list, so filter to the schemas that exist.
  mapfile -t present < <(psql -X -Atq -d baseline_replay -c \
    "select nspname from pg_namespace where nspname = any('{$(IFS=,; echo "${schemas[*]}")}')")
  args=()
  for s in "${present[@]}"; do args+=("--schema=$s"); done
  pg_dump -d baseline_replay --schema-only --no-owner --no-privileges "${args[@]}" --file="$out"
  echo "replayed schema:   ${out#"$repo"/}"
}

normalise() { # file → normalised text on stdout
  # 1. drop comments / SET / SELECT pg_catalog.set_config / blank lines and \restrict tokens
  # 2. split into statements (terminated by ';' at end of line), sort statements so that
  #    ordering differences between dump runs do not show up as drift
  sed -E \
    -e '/^--/d' -e '/^SET /d' -e '/^SELECT pg_catalog\.set_config/d' \
    -e '/^\\(un)?restrict /d' -e '/^[[:space:]]*$/d' \
    -e 's/[[:space:]]+$//' "$1" |
    awk 'BEGIN { RS = ";\n"; ORS = ";\n" } { gsub(/\n+/, "\n"); print }' |
    awk 'BEGIN { RS = ";\n"; ORS = "\0" } { print }' |
    sort -z | tr '\0' '\n'
}

cmd_diff() {
  local prod="${1:-$(ls -t "$ref_dir"/prod-schema-*.sql 2>/dev/null | head -n1)}"
  local replay="${2:-$(ls -t "$ref_dir"/replay-schema-*.sql 2>/dev/null | head -n1)}"
  [[ -f "$prod" && -f "$replay" ]] || { echo "need both dumps (run dump and replay first)" >&2; exit 2; }
  local out="$ref_dir/schema-diff-$stamp.txt"
  if diff -u --label "production" --label "replayed-migrations" \
      <(normalise "$prod") <(normalise "$replay") > "$out"; then
    echo "no schema difference (normalised)"; rm -f "$out"; return 0
  fi
  echo "schema differs: ${out#"$repo"/} ($(grep -c '^[-+][^-+]' "$out") changed lines)"
  return 1
}

case "${1:-}" in
  dump) cmd_dump ;;
  replay) cmd_replay ;;
  diff) shift; cmd_diff "$@" ;;
  all) cmd_dump; cmd_replay; cmd_diff ;;
  *) sed -n '2,22p' "$0"; exit 2 ;;
esac
