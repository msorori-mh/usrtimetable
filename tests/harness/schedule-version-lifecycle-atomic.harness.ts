import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(join(root, "src/lib/schedule-versions/lifecycle.ts"), "utf8");
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
assert(migration.includes("eligibility_updated_at"), "dependency writes advance eligibility revision");
assert(migration.includes("QUALITY_RUN_REQUIRED"), "upward transitions require explicit quality evidence");
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
