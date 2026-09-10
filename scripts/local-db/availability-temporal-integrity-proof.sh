#!/usr/bin/env bash
# LAUNCH-CLOSURE-03 — proof harness for
#   docs/migrations-proposed/20260910T0025_availability_temporal_integrity_and_bulk_rpc.sql
#
# Creates a THROWAWAY PostgreSQL cluster in a temp directory, applies the fixture and the
# migration, runs the behaviour cases, then runs a REAL two-connection concurrency test.
# The cluster is deleted on exit.
#
# It NEVER touches the project database: it unsets every PG* variable and talks to its own
# unix socket only.
set -uo pipefail

MIGRATION="docs/migrations-proposed/20260910T0025_availability_temporal_integrity_and_bulk_rpc.sql"
FIXTURE="scripts/local-db/availability-fixture.sql"
CASES="scripts/local-db/availability-cases.sql"

unset PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSSLMODE

# PostgreSQL refuses to run as root. Re-exec once as an unprivileged uid.
# initdb also needs a resolvable passwd entry for that uid.
UNPRIV_UID="${LOCAL_PG_UID:-65534}"
UNPRIV_NAME="pgproof"
if [ "$(id -u)" = "0" ] && [ -z "${AVAIL_PROOF_UNPRIV:-}" ]; then
  WORK="$(mktemp -d /tmp/availability-proof-work.XXXXXX)"
  chmod 777 "$WORK"
  if ! getent passwd "$UNPRIV_UID" >/dev/null 2>&1; then
    echo "${UNPRIV_NAME}:x:${UNPRIV_UID}:${UNPRIV_UID}:availability proof:${WORK}:/bin/bash" >> /etc/passwd
    echo "${UNPRIV_NAME}:x:${UNPRIV_UID}:" >> /etc/group
    echo "== added temporary passwd entry ${UNPRIV_NAME} (uid ${UNPRIV_UID}) for initdb"
  fi
  export AVAIL_PROOF_UNPRIV=1 HOME="$WORK" TMPDIR="$WORK"
  exec setpriv --reuid="$UNPRIV_UID" --regid="$UNPRIV_UID" --clear-groups /bin/bash "$0" "$@"
fi

ROOT="$(mktemp -d "${TMPDIR:-/tmp}/availability-proof.XXXXXX")"
PGDATA="$ROOT/data"
SOCK="$ROOT/sock"
mkdir -p "$SOCK"
export PGDATA PGHOST="$SOCK" PGDATABASE=proof PGUSER="${LOCAL_PG_SUPERUSER:-proof_owner}"

cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$ROOT"
}
trap cleanup EXIT

echo "== disposable cluster: $ROOT"
initdb -D "$PGDATA" -U "$PGUSER" --auth=trust --encoding=UTF8 --no-sync >"$ROOT/initdb.log" 2>&1 || {
  echo "FAIL: initdb failed"; tail -30 "$ROOT/initdb.log"; exit 1; }

pg_ctl -D "$PGDATA" -o "-k $SOCK -c listen_addresses='' -c fsync=off" -w -l "$ROOT/pg.log" start \
  >/dev/null 2>&1 || { echo "FAIL: cluster did not start"; tail -30 "$ROOT/pg.log"; exit 1; }

createdb "$PGDATABASE" || { echo "FAIL: createdb"; exit 1; }
echo "== postgres $(psql -tAc 'show server_version')"

echo "== applying fixture"
psql -X -q -v ON_ERROR_STOP=1 -f "$FIXTURE" >"$ROOT/fixture.log" 2>&1 || {
  echo "FAIL: fixture"; tail -40 "$ROOT/fixture.log"; exit 1; }

echo "== applying migration (syntax + executability proof)"
psql -X -q -v ON_ERROR_STOP=1 -f "$MIGRATION" >"$ROOT/migration.log" 2>&1 || {
  echo "FAIL: migration did not apply"; tail -60 "$ROOT/migration.log"; exit 1; }
echo "   migration applied cleanly"

echo "== idempotency: applying the migration a second time"
psql -X -q -v ON_ERROR_STOP=1 -f "$MIGRATION" >"$ROOT/migration2.log" 2>&1 \
  && echo "   re-apply is idempotent" \
  || { echo "FAIL: migration is not idempotent"; tail -40 "$ROOT/migration2.log"; exit 1; }

echo
echo "== behaviour cases"
psql -X -q -v ON_ERROR_STOP=1 -f "$CASES" >"$ROOT/cases.log" 2>&1
CASES_RC=$?
grep -E '^(###|NOTICE:|CASE| CASE)' "$ROOT/cases.log" | sed -E 's/^NOTICE:  //; s/^ +//'
if [ "$CASES_RC" -ne 0 ]; then
  echo "FAIL: case run aborted"; tail -40 "$ROOT/cases.log"; exit 1
fi

echo
echo "== two-connection concurrency (the case no client check can cover)"
# Both sessions insert the SAME room window in overlapping transactions.
# Session B must block on the exclusion constraint and then fail once A commits.
FA="$ROOT/fifoA"; FB="$ROOT/fifoB"
mkfifo "$FA" "$FB"
psql -X -a -v VERBOSITY=verbose -f "$FA" >"$ROOT/outA.log" 2>&1 &
PIDA=$!
psql -X -a -v VERBOSITY=verbose -f "$FB" >"$ROOT/outB.log" 2>&1 &
PIDB=$!
exec 3>"$FA"
exec 4>"$FB"

SESSION_PRE="SET ROLE authenticated; SELECT set_config('request.jwt.claims','{\"sub\":\"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\",\"role\":\"authenticated\"}',false);"
ROW="INSERT INTO public.room_unavailability (college_id, room_id, day_of_week, start_time, end_time, reason) VALUES ('11111111-1111-1111-1111-111111111111','ffffffff-ffff-ffff-ffff-ffffffffffff',6,'16:00','17:00','TEST concurrency');"

printf '%s\nBEGIN;\n%s\n' "$SESSION_PRE" "$ROW" >&3
sleep 2
printf '%s\nBEGIN;\n%s\n' "$SESSION_PRE" "$ROW" >&4   # blocks on the exclusion constraint
sleep 2
printf 'COMMIT;\n' >&3
sleep 3
printf 'COMMIT;\n' >&4
sleep 1
exec 3>&-
exec 4>&-
wait "$PIDA" "$PIDB" 2>/dev/null

if grep -q '23P01' "$ROOT/outB.log"; then
  echo "CASE 6.1 concurrent duplicate insert rejected at rest (23P01) => PASS"
  grep -m1 -A2 'ERROR' "$ROOT/outB.log" | sed 's/^/     /'
else
  echo "CASE 6.1 concurrent duplicate insert rejected at rest => FAIL"
  echo "--- session A ---"; cat "$ROOT/outA.log"
  echo "--- session B ---"; cat "$ROOT/outB.log"
  exit 1
fi

FINAL=$(psql -X -tAc "SELECT count(*) FROM public.room_unavailability WHERE reason='TEST concurrency'")
if [ "$FINAL" = "1" ]; then
  echo "CASE 6.2 exactly one row survived the race => PASS"
else
  echo "CASE 6.2 exactly one row survived the race => FAIL (found $FINAL)"; exit 1
fi

echo
echo "== rollback script"
psql -X -q -v ON_ERROR_STOP=1 -f docs/migrations-proposed/20260910T0025_rollback.sql \
  >"$ROOT/rollback.log" 2>&1 || { echo "FAIL: rollback"; tail -30 "$ROOT/rollback.log"; exit 1; }
LEFT=$(psql -X -tAc "SELECT count(*) FROM pg_constraint WHERE conname IN ('instructor_availability_no_overlap','room_unavailability_no_overlap')")
LEFTFN=$(psql -X -tAc "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('_avail_time_span','_avail_day_span','_avail_date_span','validate_room_unavailability_window','upsert_room_unavailability_for_active_days','upsert_instructor_unavailability_for_active_days','_availability_active_working_days')")
ROWS=$(psql -X -tAc "SELECT (SELECT count(*) FROM public.instructor_availability) + (SELECT count(*) FROM public.room_unavailability)")
if [ "$LEFT" = "0" ] && [ "$LEFTFN" = "0" ]; then
  echo "CASE 7.1 rollback removes every created object => PASS"
else
  echo "CASE 7.1 rollback removes every created object => FAIL (constraints=$LEFT functions=$LEFTFN)"; exit 1
fi
if [ "$ROWS" -gt 0 ]; then
  echo "CASE 7.2 rollback destroys no data (rows still present: $ROWS) => PASS"
else
  echo "CASE 7.2 rollback destroys no data => FAIL"; exit 1
fi

echo
echo "== preflight script executes against a real database"
psql -X -q -v ON_ERROR_STOP=1 -f docs/migrations-proposed/20260910T0025_preflight.sql \
  >"$ROOT/preflight.log" 2>&1 \
  && echo "CASE 7.3 preflight runs clean => PASS" \
  || { echo "CASE 7.3 preflight => FAIL"; tail -30 "$ROOT/preflight.log"; exit 1; }

echo
if grep -qE '=> FAIL' "$ROOT/cases.log"; then
  echo "RESULT: FAIL — see failing cases above"
  exit 1
fi
echo "RESULT: all cases PASS on the disposable database"
