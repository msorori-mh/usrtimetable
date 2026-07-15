/**
 * PHASE-6-ISOLATED-UAT-CHAIN-AND-TERM-INTEGRITY-DESIGN-01
 * Source-only contract checks — no DB apply.
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
  const hardenRel = "supabase/migrations/20260715200200_harden_course_offering_term_references.sql";
  const createRel =
    "supabase/migrations/20260715200300_create_isolated_schedule_builder_phase6_uat_fixture.sql";
  const cleanupRel =
    "supabase/migrations/20260715200400_cleanup_isolated_schedule_builder_phase6_uat_fixture.sql";

  // Old failed design must be gone
  assert(
    !existsSync(
      join(
        root,
        "supabase/migrations/20260715200000_create_schedule_builder_phase6_uat_fixture.sql",
      ),
    ),
    "old create fixture removed",
  );
  assert(
    !existsSync(
      join(
        root,
        "supabase/migrations/20260715200100_cleanup_schedule_builder_phase6_uat_fixture.sql",
      ),
    ),
    "old cleanup fixture removed",
  );

  assert(existsSync(join(root, hardenRel)), "harden migration present");
  assert(existsSync(join(root, createRel)), "isolated create present");
  assert(existsSync(join(root, cleanupRel)), "isolated cleanup present");
  assert(
    existsSync(join(root, "tests/fixtures/schedule-builder-phase6-uat/preflight.sql")),
    "preflight",
  );
  assert(
    existsSync(join(root, "tests/fixtures/schedule-builder-phase6-uat/postcheck.sql")),
    "postcheck",
  );

  const harden = read(hardenRel);
  const create = read(createRel);
  const cleanup = read(cleanupRel);

  // Term hardening
  assert(harden.includes("idx_course_offerings_term_id"), "term index");
  assert(harden.includes("course_offerings_term_id_fkey"), "fk name");
  assert(harden.includes("NOT VALID"), "NOT VALID");
  assert(harden.includes("ON DELETE RESTRICT"), "RESTRICT");
  assert(!/VALIDATE\s+CONSTRAINT/i.test(harden), "no VALIDATE");
  assert(!/ON DELETE CASCADE/i.test(harden), "no CASCADE");
  assert(!/SET\s+NULL/i.test(harden), "no SET NULL");
  assert(harden.includes("academic_term_delete_snapshot"), "term delete snapshot");
  assert(harden.includes("to_jsonb(OLD)"), "full OLD row");
  assert(harden.includes("'academic_year'"), "snapshot academic_year");
  assert(harden.includes("'deleted_by'"), "snapshot deleted_by");
  assert(harden.includes("'fk_validated', false"), "records not validated");

  // Isolated fixture — no legacy offering reuse
  assert(create.includes("SCHEDULE_BUILDER_PHASE6_ISOLATED_UAT"), "isolated marker");
  assert(create.includes("'uses_legacy_offering', false"), "no legacy offering");
  assert(create.includes("INSERT INTO public.course_offerings"), "creates offering");
  assert(create.includes("INSERT INTO public.teaching_assignments"), "creates assignment");
  assert(create.includes("INSERT INTO public.sections"), "creates section");
  assert(create.includes("INSERT INTO public.schedule_versions"), "creates version");
  assert(create.includes("INSERT INTO public.schedule_sessions"), "creates session");
  assert(create.includes("'draft'"), "draft version");
  assert(!/status\s*=\s*'published'/i.test(create), "no publish");
  assert(!/INSERT\s+INTO\s+public\.section_subgroups/i.test(create), "no subgroups");
  assert(!/approve_capacity_split/i.test(create), "no approve RPC call");
  assert(create.includes("2 * v_threshold"), "dynamic expected formula");
  assert(create.includes("UAT_FIXTURE_PARTIAL_STATE_FOUND"), "partial state rejected");
  assert(create.includes("ISOLATED_UAT_MASTER_CHAIN_INCOMPLETE"), "incomplete chain abort");
  assert(create.includes("idempotent_noop"), "idempotent");
  assert(create.includes("c.college_id = t.college_id"), "college align course/term");
  assert(create.includes("r.college_id = t.college_id"), "college align room/term");
  assert(create.includes("JOIN public.academic_terms"), "term join proof");
  assert(create.includes("c_offering_id constant uuid"), "fixed new offering id");
  assert(!/INTO\s+c_offering_id\b/.test(create), "offering id not selected from legacy");

  // Split math
  const cap = 60;
  const n = 2 * (cap + 5);
  const proposal = proposeCapacitySplit({
    enrollmentCount: n,
    enrollmentStatus: "confirmed",
    roomCapacity: cap,
  });
  assert(!!proposal && proposal.minimumGroups === 2, "two groups");
  assert(
    proposal!.proposedDistribution.every((g) => g.expected_students === cap + 5),
    "balanced sizes",
  );

  // Cleanup
  assert(cleanup.includes("UAT_CLEANUP_REFUSED_UNMARKED"), "refuses unmarked");
  assert(cleanup.includes("UAT_CLEANUP_TOUCHED_LEGACY_OFFERINGS"), "protects legacy 213");
  assert(cleanup.includes("DELETE FROM public.course_offerings"), "deletes UAT offering");
  assert(cleanup.includes("DELETE FROM public.teaching_assignments"), "deletes UAT TA");
  assert(!/DELETE\s+FROM\s+public\.rooms/i.test(cleanup), "no room delete");
  assert(!/DELETE\s+FROM\s+public\.courses/i.test(cleanup), "no course delete");
  assert(!/DELETE\s+FROM\s+public\.academic_terms/i.test(cleanup), "no term delete");
  assert(!/DELETE\s+FROM\s+public\.instructors/i.test(cleanup), "no instructor delete");
  assert(cleanup.includes("masters_untouched"), "masters flag");
  assert(cleanup.includes("BEGIN;") && cleanup.includes("COMMIT;"), "cleanup txn");
  assert(create.includes("BEGIN;") && create.includes("COMMIT;"), "create txn");
  assert(harden.includes("BEGIN;") && harden.includes("COMMIT;"), "harden txn");

  assert("20260715200200" < "20260715200300" && "20260715200300" < "20260715200400", "order");

  console.log("schedule-builder-phase6-uat-fixture.harness.ts: PASS");
}

run();
