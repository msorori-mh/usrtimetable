/**
 * PHASE-6-CLEAN-UAT-FIXTURE-DESIGN-01 — source-only contract checks.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { proposeCapacitySplit } from "../../src/lib/schedule-builder/section-subgroups.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");
function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  const createRel =
    "supabase/migrations/20260715200000_create_schedule_builder_phase6_uat_fixture.sql";
  const cleanupRel =
    "supabase/migrations/20260715200100_cleanup_schedule_builder_phase6_uat_fixture.sql";
  assert(existsSync(join(root, createRel)), "create migration present");
  assert(existsSync(join(root, cleanupRel)), "cleanup migration present");
  assert(
    existsSync(join(root, "tests/fixtures/schedule-builder-phase6-uat/preflight.sql")),
    "preflight sql",
  );
  assert(
    existsSync(join(root, "tests/fixtures/schedule-builder-phase6-uat/postcheck.sql")),
    "postcheck sql",
  );

  const create = read(createRel);
  const cleanup = read(cleanupRel);

  assert(create.includes("SCHEDULE_BUILDER_PHASE6_UAT"), "marker");
  assert(create.includes("UAT — Schedule Builder Phase 6"), "version name");
  assert(create.includes("status"), "status field");
  assert(create.includes("'draft'"), "draft only");
  assert(!/status\s*=\s*'published'/i.test(create), "does not publish");
  assert(create.includes("INSERT INTO public.schedule_sessions"), "creates session");
  assert(create.includes("<> 1"), "asserts single session");
  assert(!/INSERT\s+INTO\s+public\.section_subgroups/i.test(create), "no subgroups insert");
  assert(!/approve_capacity_split_proposal/i.test(create), "no approve RPC");
  assert(create.includes("rooms"), "uses existing rooms");
  assert(create.includes("ON DELETE") === false || !create.includes("CASCADE"), "no cascade seed");
  assert(create.includes("enrollment_count_status = 'confirmed'"), "confirmed for UAT");
  assert(create.includes("2 * v_threshold"), "expected from capacity formula");
  assert(create.includes("idempotent_noop") || create.includes("idempotent"), "idempotent");
  assert(create.includes("BEGIN;") && create.includes("COMMIT;"), "transaction");
  assert(create.includes("CLEAN_UAT_MASTER_CONTEXT_INCOMPLETE"), "incomplete context abort");
  assert(create.includes("UAT_FIXTURE_CONFLICT"), "conflict abort");
  assert(create.includes("migration_executor"), "executor actor");
  assert(create.includes("enrollment_previous"), "preserves previous enrollment");
  assert(create.includes("INSERT INTO public.sections"), "creates one section");
  assert(create.includes("INSERT INTO public.schedule_versions"), "creates one version");

  // Formula: n = 2*(cap+5) → 2 groups of (cap+5)
  const sampleCap = 60;
  const n = 2 * (sampleCap + 5);
  const proposal = proposeCapacitySplit({
    enrollmentCount: n,
    enrollmentStatus: "confirmed",
    roomCapacity: sampleCap,
  });
  assert(!!proposal, "proposal exists for designed n");
  assert(proposal!.minimumGroups === 2, "groups = 2");
  assert(proposal!.minimumGroups >= 2 && proposal!.minimumGroups <= 4, "groups in 2..4");
  assert(
    proposal!.proposedDistribution.every((g) => g.expected_students === sampleCap + 5),
    "balanced sizes = capacity+5",
  );
  assert(n > sampleCap + 5, "exceeds threshold");

  // Cleanup contract
  assert(cleanup.includes("UAT_CLEANUP_REFUSED_UNMARKED"), "refuses unmarked");
  assert(
    cleanup.includes("enrollment_restored") || cleanup.includes("enrollment_previous"),
    "restore enrollment",
  );
  assert(!/DELETE\s+FROM\s+public\.rooms/i.test(cleanup), "no room delete");
  assert(!/DELETE\s+FROM\s+public\.courses/i.test(cleanup), "no course delete");
  assert(!/DELETE\s+FROM\s+public\.course_offerings/i.test(cleanup), "no offering delete");
  assert(!/DELETE\s+FROM\s+public\.teaching_assignments/i.test(cleanup), "no TA delete");
  assert(!/DELETE\s+FROM\s+public\.instructors/i.test(cleanup), "no instructor delete");
  assert(cleanup.includes("DELETE FROM public.section_subgroups"), "may delete UAT subgroups");
  assert(cleanup.includes("DELETE FROM public.schedule_sessions"), "deletes UAT session");
  assert(cleanup.includes("DELETE FROM public.schedule_versions"), "deletes UAT version");
  assert(cleanup.includes("DELETE FROM public.sections"), "deletes UAT section");
  assert(
    cleanup.includes("idempotent_noop") || cleanup.includes("idempotent"),
    "cleanup idempotent",
  );
  assert(cleanup.includes("BEGIN;") && cleanup.includes("COMMIT;"), "cleanup transaction");
  assert(cleanup.includes("masters_untouched"), "masters untouched flag");

  assert("20260715200000" < "20260715200100", "order create then cleanup");

  console.log("schedule-builder-phase6-uat-fixture.harness.ts: PASS");
}

run();
