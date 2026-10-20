#!/usr/bin/env bash
# Build a Supabase-like PostgreSQL database by replaying the repository's schema history.
#
#   scripts/db/replay-migrations.sh <database-name>
#
# Connection comes from the standard libpq environment (PGHOST, PGPORT, PGUSER,
# PGPASSWORD). The database is DROPPED and re-created, so the target must be a disposable
# local/CI server: the script refuses Supabase-hosted hosts and the production project ref.
#
# Order: scripts/db/replay-order.txt lists the historical replay order (supabase/migrations
# in filename order with the docs/migrations-proposed files at the positions they were
# applied). Any supabase/migrations/*.sql file that is not listed is appended in filename
# order, so new migrations are picked up automatically.
#
# ~89 historical files do not apply on a fresh database (they were written against a live
# project). They are listed in scripts/db/replay-known-failures.txt; such files are retried
# without a transaction (same as Supabase's statement-by-statement history) and logged.
# The run FAILS when
#   - a file that is not in the known-failures list fails, or
#   - any migration with a version >= REPLAY_STRICT_FROM (default 20261020000000) fails.
#
# Environment:
#   REPLAY_LOG=<file>            failure log (default: $TMPDIR/replay-<db>.log)
#   REPLAY_STRICT_FROM=<14 digits>
#   REPLAY_UPDATE_KNOWN=1        rewrite replay-known-failures.txt from this run (maintainers)
set -euo pipefail

db="${1:?usage: replay-migrations.sh <database-name>}"
[[ "$db" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid database name: $db" >&2; exit 2; }

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
order_file="$here/replay-order.txt"
known_file="$here/replay-known-failures.txt"
shim="$here/supabase-shim.sql"
strict_from="${REPLAY_STRICT_FROM:-20261020000000}"
log="${REPLAY_LOG:-${TMPDIR:-/tmp}/replay-$db.log}"

production_ref="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$repo/supabase/config.toml" | head -n1)"
target="${PGHOST:-local}:${PGPORT:-5432} ${DATABASE_URL:-}"
case "$target" in
  *supabase.co* | *supabase.com* | *pooler.supabase* | *"$production_ref"*)
    echo "refusing to replay against a Supabase-hosted target ($PGHOST)" >&2
    exit 2
    ;;
esac

export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"
psql_base=(psql -X -q)

"${psql_base[@]}" -d template1 -v ON_ERROR_STOP=1 \
  -c "drop database if exists $db" -c "create database $db" >/dev/null
# The shim creates cluster-wide roles; on a second database they already exist, so it is
# applied without ON_ERROR_STOP (each statement is independent).
"${psql_base[@]}" -d "$db" -f "$shim" >/dev/null 2>&1 || true
# Supabase default: extensions (pgcrypto, uuid-ossp, pg_trgm) resolve unqualified.
"${psql_base[@]}" -d template1 -v ON_ERROR_STOP=1 \
  -c "alter database $db set search_path = public, extensions" >/dev/null

mapfile -t ordered < <(grep -v '^[[:space:]]*\(#\|$\)' "$order_file")
mapfile -t extra < <(cd "$repo" && ls supabase/migrations/*.sql | sort | grep -vxF -f "$order_file" || true)

: > "$log"
applied=0
unexpected=()
for rel in "${ordered[@]}" "${extra[@]}"; do
  file="$repo/$rel"
  [[ -f "$file" ]] || continue
  applied=$((applied + 1))
  if err="$("${psql_base[@]}" -d "$db" -v ON_ERROR_STOP=1 -1 -f "$file" 2>&1 >/dev/null)"; then
    continue
  fi
  first="$(printf '%s\n' "$err" | grep -m1 ERROR || printf '%s' "$err" | head -n1)"
  printf '== %s :: %s\n' "$rel" "$first" >> "$log"
  # Statement-by-statement retry keeps the parts that do apply (historical behaviour).
  "${psql_base[@]}" -d "$db" -f "$file" >/dev/null 2>&1 || true
  version="$(basename "$rel" | grep -o '^[0-9]\{14\}' || true)"
  if [[ "$rel" == supabase/migrations/* && -n "$version" && "$version" -ge "$strict_from" ]]; then
    unexpected+=("$rel (version >= $strict_from must apply cleanly)")
  elif ! grep -qxF "$rel" "$known_file" 2>/dev/null; then
    unexpected+=("$rel")
  fi
done

failed="$(grep -c '^==' "$log" || true)"
if [[ "${REPLAY_UPDATE_KNOWN:-0}" == "1" ]]; then
  sed 's/^== \(.*\) :: .*/\1/' "$log" > "$known_file"
  echo "updated $known_file ($failed entries)"
  unexpected=()
fi

echo "replayed $applied files into $db; failing files: $failed (log: $log)"
if ((${#unexpected[@]})); then
  echo "UNEXPECTED replay failures:" >&2
  for rel in "${unexpected[@]}"; do
    echo "  - $rel" >&2
    grep -F "== ${rel%% (*} ::" "$log" | sed 's/^/      /' >&2 || true
  done
  exit 1
fi
