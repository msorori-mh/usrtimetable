import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migration = readFileSync(
  join(
    root,
    "supabase/migrations/20260722100000_source_only_schedule_version_lifecycle.sql",
  ),
  "utf8",
);

assert(
  migration.startsWith(
    "-- SOURCE ONLY — NOT APPLIED — gate APPROVE_DB_MIGRATION_APPLY",
  ),
  "migration is explicitly source-only and gated",
);
assert(
  migration.includes("CREATE OR REPLACE FUNCTION public.transition_schedule_version"),
  "transition RPC present",
);
for (const edge of [
  "('draft', 'review')",
  "('review', 'approved')",
  "('approved', 'published')",
  "('published', 'archived')",
  "('review', 'draft')",
  "('approved', 'review')",
]) {
  assert(migration.includes(edge), `transition matrix edge present: ${edge}`);
}
assert(
  !migration.includes("('archived',"),
  "archived is terminal: no outgoing transition edges",
);
assert(
  migration.includes("INVALID_SCHEDULE_VERSION_TRANSITION"),
  "invalid transitions raise an exception",
);
assert(
  migration.includes("v_version.status <> p_expected_status") &&
    migration.includes("STALE_VERSION_STATUS"),
  "optimistic expected-status compare rejects stale transitions",
);
assert(
  migration.includes("can_manage_college(v_actor, p_college_id)"),
  "tenant-scoped can_manage_college enforcement present",
);
assert(
  migration.includes("public.is_super_admin(v_actor)"),
  "super_admin resolution present",
);
assert(
  migration.includes("REVIEW_NOTES_REQUIRED"),
  "reject/revoke edges require review notes",
);
assert(
  migration.includes("PUBLISH_OVERRIDE_NOTES_REQUIRED"),
  "publish restricted to college_admin; super_admin override requires notes",
);
assert(
  migration.includes("INSERT INTO public.schedule_version_events") &&
    migration.includes("actor_role"),
  "lifecycle history captures actor and role",
);
assert(
  migration.includes("INSERT INTO public.audit_logs"),
  "audit_logs insert present",
);
assert(
  migration.indexOf("UPDATE public.schedule_versions SET status") <
    migration.indexOf("INSERT INTO public.schedule_version_events") &&
    migration.indexOf("INSERT INTO public.schedule_version_events") <
      migration.indexOf("INSERT INTO public.audit_logs"),
  "mutation, history, and audit share one atomic transaction",
);
assert(
  migration.includes(
    "REVOKE ALL ON FUNCTION public.transition_schedule_version(uuid, uuid, text, text, text) FROM PUBLIC, anon",
  ) && migration.includes("TO authenticated, service_role"),
  "REVOKE/GRANT discipline on transition RPC",
);
assert(
  migration.includes(
    "REVOKE UPDATE ON public.schedule_versions FROM authenticated",
  ),
  "no general bypass of the RPC for status mutation",
);
assert(
  migration.includes(
    "ALTER TABLE public.schedule_version_events ENABLE ROW LEVEL SECURITY",
  ) && migration.includes("can_view_college(auth.uid(), college_id)"),
  "college-scoped RLS on lifecycle history",
);
assert(
  migration.includes(
    "REVOKE UPDATE, DELETE ON public.schedule_version_events FROM authenticated, anon",
  ),
  "lifecycle history is append-only for clients",
);
assert(
  migration.includes(
    "CREATE OR REPLACE FUNCTION public.list_schedule_version_lifecycle_events",
  ),
  "lifecycle history read RPC present",
);

console.log("schedule-version-lifecycle.harness.ts: PASS");
