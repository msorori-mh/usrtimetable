import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migrationPath = "supabase/migrations/20260730120000_source_only_disposable_draft_purge.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");
const dependencyPatch = readFileSync(
  join(root, "supabase/migrations/20260928213000_fix_disposable_clone_purge_dependencies.sql"),
  "utf8",
);
const cloneMigration = readFileSync(
  join(root, "supabase/migrations/20260918180000_atomic_current_assignment_clone.sql"),
  "utf8",
);
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
assert(migration.includes("purge_disposable_draft_schedule_version"), "purge RPC exists");
assert(
  migration.includes("SECURITY DEFINER") && migration.includes("SET search_path = public, pg_temp"),
  "purge RPC uses SECURITY DEFINER with fixed search_path",
);
assert(migration.includes("is_super_admin(v_actor)"), "purge requires super_admin");
assert(migration.includes("PURGE_SUPER_ADMIN_REQUIRED"), "non-super_admin direct RPC is blocked");
assert(migration.includes("AUTHENTICATION_REQUIRED"), "anon/unauthenticated is blocked");
assert(migration.includes("status IS DISTINCT FROM 'draft'"), "only draft status allowed");
assert(
  migration.includes("PURGE_STATUS_NOT_DRAFT"),
  "approved/published/archived rejected via status",
);
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
  migration.includes(
    "REVOKE ALL ON FUNCTION public.purge_disposable_draft_schedule_version(uuid)",
  ) && migration.includes("FROM PUBLIC, anon, authenticated"),
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
  cloneMigration.includes("DISPOSABLE_CLONE_SUPER_ADMIN_REQUIRED") &&
    cloneMigration.includes("NOT public.is_super_admin(v_actor)"),
  "clone refuses disposable marker for non-super_admin",
);
assert(
  lifecycle.includes("p_disposable_test: params.disposableTest === true"),
  "clone writes disposable_test only when explicitly requested",
);
assert(
  /supabase\.rpc\(\s*PURGE_RPC_NAME/.test(lifecycle) ||
    lifecycle.includes('rpc("purge_disposable_draft_schedule_version"'),
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
  cloneMigration.includes("p_disposable_test boolean DEFAULT false") &&
    lifecycle.includes("p_disposable_test: params.disposableTest === true"),
  "default clones are not auto-marked disposable",
);

for (const guard of [
  "PURGE_VERSION_HAS_CLONES",
  "PURGE_VERSION_HAS_SOURCE_REVISIONS",
  "PURGE_VERSION_HAS_CUTOVER_PROFILE",
  "PURGE_EXTERNAL_SESSION_REFERENCE",
  "PURGE_EXTERNAL_SOURCE_ROW_REFERENCE",
]) {
  assert(dependencyPatch.includes(guard), `dependency purge guard missing: ${guard}`);
}

for (const table of [
  "assignment_version_private.scope",
  "schedule_version_delivery_private.group_partition_facts",
  "schedule_version_delivery_private.partner_partition_facts",
  "schedule_version_delivery_private.instructor_hour_waivers",
  "schedule_version_delivery_private.group_facts",
  "schedule_version_delivery_private.partition_facts",
  "schedule_version_delivery_private.partner_group_facts",
  "schedule_version_delivery_private.cohort_facts",
  "schedule_version_delivery_private.scope",
  "schedule_version_delivery_private.clone_provenance",
  "education_source_revision_private.revisions",
  "jawf_term_source_private.sessions",
]) {
  assert(
    dependencyPatch.includes(`DELETE FROM ${table}`),
    `dependency delete missing for ${table}`,
  );
}

assert(
  dependencyPatch.indexOf("DELETE FROM schedule_version_delivery_private.group_partition_facts") <
    dependencyPatch.indexOf("DELETE FROM schedule_version_delivery_private.group_facts"),
  "group-partition facts must be deleted before group facts",
);
assert(
  dependencyPatch.indexOf("DELETE FROM schedule_version_delivery_private.cohort_facts") <
    dependencyPatch.indexOf("DELETE FROM schedule_version_delivery_private.scope"),
  "cohort facts must be deleted before delivery scope",
);
assert(
  dependencyPatch.indexOf("DELETE FROM schedule_version_delivery_private.scope") <
    dependencyPatch.indexOf("DELETE FROM public.schedule_versions"),
  "delivery scope must be deleted before the schedule version",
);

console.log("disposable-draft-purge.harness.ts: PASS");
