#!/usr/bin/env bash
# Regenerate bun.lock against the public npm registry (Lovable exit, step A).
#
# The committed bun.lock was produced inside the Lovable sandbox: many entries resolve to
# Lovable's private package cache (…-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache) and it
# still lists @lovable.dev/vite-tanstack-config. Until this script has been run once and the
# new bun.lock committed, `bun install --frozen-lockfile` (pr-gate, deploy workflows) FAILS,
# because package.json no longer matches the lockfile.
#
# Usage (on a machine with internet access, from the repository root):
#   scripts/exit-lovable/regenerate-lockfile.sh            # regenerate + verify + build
#   SKIP_BUILD=1 scripts/exit-lovable/regenerate-lockfile.sh
# Then review `git diff --stat bun.lock` and commit bun.lock.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

REGISTRY="${NPM_REGISTRY:-https://registry.npmjs.org}"
BACKUP="bun.lock.lovable-backup"

command -v bun >/dev/null || { echo "bun is required (https://bun.sh)"; exit 1; }

if grep -q '@lovable.dev' package.json; then
  echo "package.json still references @lovable.dev — remove it first"; exit 1
fi

if [ -f bun.lock ]; then
  mv bun.lock "$BACKUP"
  echo "moved old lockfile to $BACKUP"
fi
restore() {
  if [ ! -f bun.lock ] && [ -f "$BACKUP" ]; then mv "$BACKUP" bun.lock; echo "restored old lockfile"; fi
}
trap restore ERR

rm -rf node_modules
# Force the public registry even if a user/global bunfig or .npmrc points elsewhere.
BUN_CONFIG_REGISTRY="$REGISTRY" NPM_CONFIG_REGISTRY="$REGISTRY" bun install --registry "$REGISTRY"

fail=0
if grep -q 'lovable-core-prod' bun.lock; then
  echo "FAIL: bun.lock still contains lovable-core-prod URLs:"; grep -n 'lovable-core-prod' bun.lock | head; fail=1
fi
if grep -q '"@lovable.dev/' bun.lock; then
  echo "FAIL: bun.lock still contains an @lovable.dev package"; grep -n '"@lovable.dev/' bun.lock | head; fail=1
fi
if [ -d node_modules/@lovable.dev ]; then
  echo "FAIL: node_modules/@lovable.dev was installed"; fail=1
fi
[ "$fail" = 0 ] || exit 1
echo "OK: lockfile resolves only to $REGISTRY (no Lovable registry, no @lovable.dev packages)"

# Frozen install must now succeed (what CI does).
bun install --frozen-lockfile

if [ "${SKIP_BUILD:-0}" != "1" ]; then
  bun run build
  test -f .output/server/wrangler.json || { echo "FAIL: .output/server/wrangler.json not generated"; exit 1; }
  node -e '
    const c = JSON.parse(require("fs").readFileSync(".output/server/wrangler.json", "utf8"));
    const problems = [];
    if (c.main !== "index.mjs") problems.push("main != index.mjs");
    if (c.no_bundle !== true) problems.push("no_bundle != true");
    if (c.assets?.directory !== "../public") problems.push("assets.directory != ../public");
    if (!(c.compatibility_flags ?? []).includes("nodejs_compat")) problems.push("compatibility_flags lacks nodejs_compat");
    if (!(String(c.compatibility_date ?? "") >= "2025-04-01")) problems.push("compatibility_date < 2025-04-01");
    if (problems.length) { console.error("FAIL wrangler.json: " + problems.join(", ")); process.exit(1); }
    console.log("OK: generated wrangler.json", JSON.stringify({ main: c.main, compatibility_date: c.compatibility_date, compatibility_flags: c.compatibility_flags }));
  '
fi

rm -f "$BACKUP"
trap - ERR
echo "Done. Review and commit: git add bun.lock && git commit -m 'Regenerate bun.lock against registry.npmjs.org'"
