import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(join(root, "src/lib/schedule-versions/lifecycle.ts"), "utf8");
const scorer = readFileSync(join(root, "src/lib/conflict-engine/scorer.ts"), "utf8");
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260718120000_source_only_atomic_schedule_version_lifecycle.sql",
  ),
  "utf8",
);

assert(source.includes('rpc("transition_schedule_version"'), "client uses atomic RPC");
assert(!source.includes(".update({ status: to })"), "client cannot separately mutate status");
assert(
  migration.includes("can_manage_college(v_actor, p_college_id)"),
  "RPC authorizes actor in tenant",
);
assert(migration.includes("STALE_VERSION_STATUS"), "RPC rejects stale expected status");
assert(
  migration.includes("eligibility_revision bigint"),
  "numeric eligibility revision is persisted",
);
assert(
  migration.includes("begin_schedule_quality_snapshot") &&
    migration.includes("persist_schedule_quality_run"),
  "quality snapshot and conditional persist RPCs exist",
);
assert(migration.includes("STALE_QUALITY_SNAPSHOT"), "stale scoring snapshot fails closed");
assert(
  migration.includes("v_quality_revision IS DISTINCT FROM v_version.eligibility_revision"),
  "transition requires exact quality revision",
);
assert(
  migration.includes("QUALITY_RUN_REQUIRED"),
  "upward transitions require explicit quality evidence",
);
assert(migration.includes("QUALITY_RUN_STALE"), "stale quality evidence fails closed");
assert(migration.includes("pg_advisory_xact_lock"), "eligibility inputs serialize with transition");
assert(
  migration.includes("trg_cc_lifecycle_dependency_lock"),
  "conflict writes share lifecycle lock",
);
assert(
  migration.includes("trg_svce_lifecycle_dependency_lock"),
  "exception writes share lifecycle lock",
);
assert(
  migration.includes("REVOKE UPDATE ON public.schedule_versions"),
  "direct status updates are closed",
);
assert(
  migration.includes("REVOKE INSERT, UPDATE, DELETE ON public.schedule_quality_runs"),
  "direct quality-run forgery is closed",
);
assert(
  migration.includes("ARRAY[v_old_id, v_new_id]") && migration.includes("ORDER BY ids.x::text"),
  "OLD and NEW versions are invalidated under deterministic locks",
);
assert(
  migration.includes("LIFECYCLE_DEPENDENCY_TENANT_MISMATCH"),
  "dependency rows are tenant validated",
);
for (const trigger of [
  "trg_rooms_lifecycle_invalidate",
  "trg_ra_lifecycle_invalidate",
  "trg_ia_lifecycle_invalidate",
  "trg_co_lifecycle_invalidate",
  "trg_tst_lifecycle_invalidate",
  "trg_instructors_lifecycle_invalidate",
  "trg_ta_lifecycle_invalidate",
  "trg_cqs_lifecycle_invalidate",
  "trg_qm_lifecycle_invalidate",
]) {
  assert(migration.includes(trigger), `missing scorer-input invalidation: ${trigger}`);
}
assert(
  migration.includes("sv.college_id IN (v_old_college, v_new_college)"),
  "college moves invalidate both OLD and NEW tenants",
);
assert(
  migration.includes("TG_TABLE_NAME = 'quality_metrics'"),
  "global quality metric changes invalidate all versions",
);
assert(
  scorer.indexOf('rpc(\n    "begin_schedule_quality_snapshot"') <
    scorer.indexOf('.from("schedule_sessions")'),
  "scorer snapshots revision before eligibility reads",
);
assert(
  scorer.includes('rpc("persist_schedule_quality_run"') &&
    !scorer.includes('.from("schedule_quality_runs")\n    .insert'),
  "scorer persists conditionally through RPC only",
);
assert(
  migration.indexOf("UPDATE public.schedule_versions SET status") <
    migration.indexOf("INSERT INTO public.schedule_version_events"),
  "mutation and audit share function",
);
assert(
  migration.includes("IMMUTABLE_SCHEDULE_VERSION"),
  "published and archived metadata are immutable",
);
assert(migration.startsWith("-- SOURCE-ONLY / NOT APPLIED"), "migration is explicitly not applied");

console.log("schedule-version-lifecycle-atomic.harness.ts: PASS");
