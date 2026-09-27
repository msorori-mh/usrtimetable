#!/usr/bin/env bash
# Runs the Rev3 workload/guard proof in a throwaway local Postgres. Never production.
set -euo pipefail
cd "$(dirname "$0")"
# Extract the Rev2 writer functions verbatim so Rev3 patches their real text.
python3 - <<'PY'
import re
src = open('../docs/migrations-proposed/20260927_itcs_version_scoped_assignments.sql').read()
names = ['public.version_effective_assignments', 'public.validate_version_assignment_allocation',
         'public.schedule_version_session_snapshot', 'assignment_version_private.apply_replacement',
         'public.preview_version_session_moves', 'public.apply_version_session_moves']
out = []
for n in names:
    m = re.search(r'^CREATE FUNCTION ' + re.escape(n) + r'\(.*?^(?:END )?\$\$;\n', src, re.S | re.M)
    if not m: raise SystemExit('extract failed: ' + n)
    out.append(m.group(0))
open('.rev2-writers.sql', 'w').write('\n'.join(out))
PY
DIR=$(mktemp -d)
initdb -D "$DIR" -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p 55441 -k $DIR -c listen_addresses=''" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m immediate stop >/dev/null; rm -rf "$DIR" .rev2-writers.sql' EXIT
psql -h "$DIR" -p 55441 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f itcs-version-scoped-workload-guards-db.sql
