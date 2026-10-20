#!/usr/bin/env bash
# Compare repository migrations with the versions applied in a database (M-24).
#
#   PROD_DB_READONLY_URL=postgresql://readonly…  scripts/db/migration-drift.sh
#   scripts/db/migration-drift.sh --applied-file=<file with one version per line>
#
# Reads supabase_migrations.schema_migrations in a READ ONLY transaction; never writes.
# Exit 0 = no drift, 1 = drift (details printed), 2 = usage/connection error.
#   missing_in_db:   versions present in supabase/migrations but not applied
#   unknown_in_repo: versions applied in the database with no file in the repository
#                    (e.g. a change made in the SQL editor without a commit)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
applied_file=""
for arg in "$@"; do
  case "$arg" in
    --applied-file=*) applied_file="${arg#--applied-file=}" ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Repository versions: the numeric prefix before the first "_" (several files may share a
# version prefix; the CLI records each version once).
(cd "$repo/supabase/migrations" && ls *.sql) | sed -n 's/^\([0-9]\{8,14\}\)_.*/\1/p' | sort -u > "$work/repo"

if [[ -n "$applied_file" ]]; then
  grep -oE '^[0-9]{8,14}' "$applied_file" | sort -u > "$work/db"
else
  url="${PROD_DB_READONLY_URL:-}"
  [[ -n "$url" ]] || { echo "PROD_DB_READONLY_URL is not set" >&2; exit 2; }
  if ! psql "$url" -X -Atq -v ON_ERROR_STOP=1 \
      -c "begin transaction read only" \
      -c "select version from supabase_migrations.schema_migrations order by version" \
      -c "rollback" > "$work/raw" 2> "$work/err"; then
    # Print only the error class, never the connection string.
    sed -E 's#postgres(ql)?://[^ ]+#<redacted>#g' "$work/err" | grep -m1 -E 'ERROR|FATAL|could not' >&2 || true
    exit 2
  fi
  grep -oE '^[0-9]{8,14}' "$work/raw" | sort -u > "$work/db"
fi

comm -23 "$work/repo" "$work/db" > "$work/missing"
comm -13 "$work/repo" "$work/db" > "$work/unknown"

echo "repository versions: $(wc -l < "$work/repo"), applied versions: $(wc -l < "$work/db")"
status=0
if [[ -s "$work/missing" ]]; then
  status=1
  echo "missing_in_db ($(wc -l < "$work/missing")): migrations committed but not applied:"
  while read -r v; do
    printf '  %s  %s\n' "$v" "$(cd "$repo/supabase/migrations" && ls "${v}"_*.sql | tr '\n' ' ')"
  done < "$work/missing"
fi
if [[ -s "$work/unknown" ]]; then
  status=1
  echo "unknown_in_repo ($(wc -l < "$work/unknown")): applied in the database but no file in supabase/migrations:"
  sed 's/^/  /' "$work/unknown"
fi
if [[ "$status" == 0 ]]; then
  echo "no migration drift"
else
  echo "see docs/operations/release-runbook.md (§ الانحراف) for how to resolve drift"
fi
exit "$status"
