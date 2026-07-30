import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath =
  "supabase/migrations/20260730120000_source_only_disposable_draft_purge.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");
const lifecycle = readFileSync(join(root, "src/lib/schedule-versions/lifecycle.ts"), "utf8");
const purgeHelper = readFileSync(
  join(root, "src/lib/schedule-versions/disposable-purge.ts"),
  "utf8",
);
const scheduleVersionsUi = readFileSync(
  join(root, "src/routes/_authenticated/schedule-versions.tsx"),
  "utf8",
);

assert(migration.startsWith("-- SOURCE-ONLY / NOT APPLIED"), "migration is explicitly not applied");
assert(
  migration.includes("ADD COLUMN IF NOT EXISTS disposable_test boolean NOT NULL DEFAULT false"),
  "disposable_test marker column is required",
);
assert(
  migration.includes("purge_disposable_draft_schedule_version"),
  "purge RPC exists",
);
assert(
  migration.includes("SECURITY DEFINER") &&
    migration.includes("SET search_path = public, pg_temp"),
  "purge RPC uses SECURITY DEFINER with fixed search_path",
);
assert(migration.includes("is_super_admin(v_actor)"), "purge requires super_admin");
assert(
  migration.includes("PURGE_SUPER_ADMIN_REQUIRED"),
  "non-super_admin direct RPC is blocked",
);
assert(migration.includes("AUTHENTICATION_REQUIRED"), "anon/unauthenticated is blocked");
assert(migration.includes("status IS DISTINCT FROM 'draft'"), "only draft status allowed");
assert(migration.includes("PURGE_STATUS_NOT_DRAFT"), "approved/published/archived rejected via status");
assert(migration.includes("PURGE_NOT_DISPOSABLE"), "unmarked drafts rejected");
assert(
  migration.includes("835e50fe-3ad2-4232-8c15-0f403c668a7f"),
  "protected accepted version is hard-guarded",
);
assert(migration.includes("PURGE_PROTECTED_VERSION"), "protected version raises");
assert(migration.includes("PURGE_CROSS_COLLEGE_DEPENDENT"), "cross-college dependents fail closed");
assert(migration.includes("PURGE_ORPHAN_ROWS_REMAIN"), "orphan rows fail closed");
assert(migration.includes("already_absent"), "idempotent re-call returns already_absent");

for (const table of [
  "schedule_sessions",
  "schedule_version_events",
  "conflict_checks",
  "conflict_results",
  "schedule_version_conflict_exceptions",
  "schedule_quality_runs",
  "auto_schedule_runs",
  "schedule_versions",
]) {
  assert(
    migration.includes(`DELETE FROM public.${table}`),
    `dependent delete missing for ${table}`,
  );
}

assert(
  migration.includes("REVOKE ALL ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)") &&
    migration.includes("FROM PUBLIC, anon, authenticated"),
  "PUBLIC/anon/authenticated execute revoked before official grant",
);
assert(
  /GRANT EXECUTE ON FUNCTION public\.purge_disposable_draft_schedule_version\(uuid\)\s+TO authenticated/.test(
    migration,
  ),
  "official EXECUTE grant is to authenticated with in-function super_admin check",
);
assert(
  !/GRANT EXECUTE[\s\S]*purge_disposable_draft_schedule_version[\s\S]*TO anon/.test(migration),
  "anon must not receive EXECUTE",
);
assert(
  migration.includes("enforce_disposable_test_super_admin_only"),
  "only super_admin may set disposable_test marker",
);

assert(lifecycle.includes("disposableTest"), "clone path accepts disposableTest flag");
assert(
  lifecycle.includes("DISPOSABLE_CLONE_SUPER_ADMIN_REQUIRED"),
  "clone refuses disposable marker for non-super_admin",
);
assert(
  lifecycle.includes('disposable_test: markDisposable'),
  "clone writes disposable_test only when explicitly requested",
);
assert(
  lifecycle.includes('rpc(PURGE_RPC_NAME') || lifecycle.includes('rpc("purge_disposable_draft_schedule_version"'),
  "client purge helper calls official RPC",
);
assert(
  purgeHelper.includes("835e50fe-3ad2-4232-8c15-0f403c668a7f"),
  "client protects accepted version id",
);
assert(
  scheduleVersionsUi.includes("canMarkDisposable") &&
    scheduleVersionsUi.includes("disposable_test"),
  "UI exposes disposable marker only via canMarkDisposable path",
);
assert(
  !lifecycle.includes("disposable_test: true") || lifecycle.includes("markDisposable"),
  "default clones are not auto-marked disposable",
);

console.log("disposable-draft-purge.harness.ts: PASS");
