#!/usr/bin/env bash
# Runs the version-scoped assignment proof in a throwaway local Postgres. Never production.
set -euo pipefail
DIR=$(mktemp -d)
initdb -D "$DIR" -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p 55439 -k $DIR -c listen_addresses=''" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m immediate stop >/dev/null; rm -rf "$DIR"' EXIT
cd "$(dirname "$0")"
psql -h "$DIR" -p 55439 -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
  -f itcs-version-scoped-assignments-db.sql
