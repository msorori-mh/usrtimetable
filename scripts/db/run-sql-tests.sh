#!/usr/bin/env bash
# Run the repository's SQL tests (tests/*.sql, supabase/tests/*.sql) by tier.
#
#   scripts/db/run-sql-tests.sh [--tier=empty|migrated|runner|all] [--no-replay]
#
# Tiers come from scripts/db/sql-tests.txt (unlisted files default to "migrated").
#   migrated: replays the schema once into $SQL_TEST_TEMPLATE (default sqltest_template)
#             with scripts/db/replay-migrations.sh on the server given by PGHOST/PGPORT/
#             PGUSER/PGPASSWORD, then runs each file in a fresh clone of that template.
#   empty:    each file gets its own throwaway cluster (initdb + pg_ctl from the local
#             PostgreSQL installation), because those files CREATE ROLE and roles are
#             cluster-wide.
#   runner:   executes the listed tests/run-*.sh (they manage their own clusters).
# Never point this at a real Supabase project: replay-migrations.sh refuses hosted targets.
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
manifest="$here/sql-tests.txt"
tier="all"
replay=1
for arg in "$@"; do
  case "$arg" in
    --tier=*) tier="${arg#--tier=}" ;;
    --no-replay) replay=0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done
template="${SQL_TEST_TEMPLATE:-sqltest_template}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

# Resolve PostgreSQL server binaries for throwaway clusters.
pg_bin="${PG_BIN:-}"
if [[ -z "$pg_bin" ]]; then
  if command -v pg_config >/dev/null 2>&1 && [[ -x "$(pg_config --bindir)/initdb" ]]; then
    pg_bin="$(pg_config --bindir)"
  else
    pg_bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n1)"
  fi
fi

declare -A mode_of reason_of
while read -r mode path rest; do
  [[ -z "${mode:-}" || "$mode" == \#* ]] && continue
  mode_of["$path"]="$mode"
  reason_of["$path"]="${rest#\# }"
done < "$manifest"

mapfile -t sql_files < <(cd "$repo" && ls tests/*.sql supabase/tests/*.sql 2>/dev/null | sort)
for f in "${sql_files[@]}"; do [[ -n "${mode_of[$f]:-}" ]] || mode_of["$f"]="migrated"; done

pass=0
fail=0
known=0
skipped=0
failures=()

report() { # status file detail
  printf '%-10s %s%s\n' "$1" "$2" "${3:+  — $3}"
}

run_psql_file() { # db file  (connection from env)
  (cd "$repo" && psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null 2>"$work/err") && return 0
  grep -m1 ERROR "$work/err" | cut -c1-240 > "$work/first" || true
  return 1
}

work="$(mktemp -d)"
cleanup() { rm -rf "$work"; }
trap cleanup EXIT

# ---------- runner tier ----------
if [[ "$tier" == all || "$tier" == runner ]]; then
  for f in $(printf '%s\n' "${!mode_of[@]}" | sort); do
    [[ "${mode_of[$f]}" == runner ]] || continue
    if [[ "$(id -u)" == 0 ]]; then
      # The runners call initdb themselves, which refuses to run as root (CI is non-root).
      skipped=$((skipped + 1)); report SKIP "$f" "runner needs a non-root user"
      continue
    fi
    if PATH="$pg_bin:$PATH" bash "$repo/$f" >"$work/out" 2>&1; then
      pass=$((pass + 1)); report PASS "$f"
    else
      fail=$((fail + 1)); failures+=("$f"); report FAIL "$f" "$(grep -m1 -E 'ERROR|FAIL' "$work/out" | cut -c1-200)"
    fi
  done
fi

# ---------- empty tier ----------
if [[ "$tier" == all || "$tier" == empty ]]; then
  [[ -x "$pg_bin/initdb" ]] || { echo "initdb not found (set PG_BIN)" >&2; exit 2; }
  as=()
  if [[ "$(id -u)" == 0 ]]; then
    # initdb refuses to run as root; use an unprivileged uid for the throwaway cluster.
    as=(setpriv --reuid=65534 --regid=65534 --clear-groups)
  fi
  port="${SQL_TEST_EMPTY_PORT:-55433}"
  for f in "${sql_files[@]}"; do
    [[ "${mode_of[$f]}" == empty ]] || continue
    cluster="$work/cluster"
    rm -rf "$cluster"; mkdir -p "$cluster"
    [[ ${#as[@]} -eq 0 ]] || chown 65534:65534 "$cluster" "$work"
    "${as[@]}" "$pg_bin/initdb" -D "$cluster/data" -U postgres -A trust -E UTF8 --locale=C.UTF-8 >/dev/null 2>&1
    "${as[@]}" "$pg_bin/pg_ctl" -D "$cluster/data" -o "-p $port -k $cluster -c listen_addresses=''" -w start >/dev/null 2>&1
    if PGHOST="$cluster" PGPORT="$port" PGUSER=postgres PGPASSWORD="" run_psql_file postgres "$f"; then
      pass=$((pass + 1)); report PASS "$f" "(empty cluster)"
    else
      fail=$((fail + 1)); failures+=("$f"); report FAIL "$f" "$(cat "$work/first")"
    fi
    "${as[@]}" "$pg_bin/pg_ctl" -D "$cluster/data" -m immediate stop >/dev/null 2>&1
  done
fi

# ---------- migrated tier ----------
if [[ "$tier" == all || "$tier" == migrated ]]; then
  if [[ "$replay" == 1 ]]; then
    "$here/replay-migrations.sh" "$template" || { echo "schema replay failed" >&2; exit 1; }
  fi
  i=0
  for f in "${sql_files[@]}"; do
    mode="${mode_of[$f]}"
    [[ "$mode" == migrated || "$mode" == known-fail ]] || continue
    i=$((i + 1))
    db="sqltest_run_$i"
    psql -X -q -d template1 -c "drop database if exists $db" -c "create database $db template $template" >/dev/null
    if run_psql_file "$db" "$f"; then
      if [[ "$mode" == known-fail ]]; then
        fail=$((fail + 1)); failures+=("$f (listed as known-fail but passes: update sql-tests.txt)")
        report XPASS "$f"
      else
        pass=$((pass + 1)); report PASS "$f" "(migrated schema)"
      fi
    elif [[ "$mode" == known-fail ]]; then
      known=$((known + 1)); report KNOWN "$f" "${reason_of[$f]:-}"
    else
      fail=$((fail + 1)); failures+=("$f"); report FAIL "$f" "$(cat "$work/first")"
    fi
    psql -X -q -d template1 -c "drop database if exists $db" >/dev/null
  done
fi

for f in "${sql_files[@]}"; do
  if [[ "${mode_of[$f]}" == skip ]]; then
    skipped=$((skipped + 1))
    [[ "$tier" == all ]] && report SKIP "$f" "${reason_of[$f]:-}"
  fi
done

echo
echo "SQL tests: $pass passed, $fail failed, $known known failures, $skipped skipped"
if ((fail)); then
  printf '  failed: %s\n' "${failures[@]}"
  exit 1
fi
