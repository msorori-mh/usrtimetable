#!/usr/bin/env bash
# Compiles the proposed Rev5 orchestrator and proves path rules in a throwaway local Postgres. Never production.
set -euo pipefail
cd "$(dirname "$0")"
DIR=$(mktemp -d)
initdb -D "$DIR" -U postgres >/dev/null
pg_ctl -D "$DIR" -o "-p 55442 -k $DIR -c listen_addresses=''" -w start >/dev/null
trap 'pg_ctl -D "$DIR" -m immediate stop >/dev/null; rm -rf "$DIR"' EXIT
psql -h "$DIR" -p 55442 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f itcs-cutover-orchestrator-db.sql
