/**
 * Compact conflict-RPC migration equivalence + size/security gates.
 * Fixtures only — no live DB / no enrollment seed data.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  conflictMessageAr,
  enrichConflictMessages,
} from "../../src/lib/schedule-builder/conflict-code-messages";
import { evaluateCapacityAgainstRoom } from "../../src/lib/schedule-builder/enrollment-trust";
import { sameSectionSubgroupConflict } from "../../src/lib/schedule-builder/section-subgroups";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const migDir = join(root, "supabase/migrations");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

/** Mirror of _ss_cap outcome codes from SQL helper. */
function capacityCode(
  status: string,
  n: number,
  cap: number,
): "room_capacity" | "room_capacity_unverified" | null {
  const ev = evaluateCapacityAgainstRoom({
    enrollmentCount: n,
    enrollmentStatus: status,
    roomCapacity: cap,
  });
  if (ev.outcome === "hard_block") return "room_capacity";
  if (ev.outcome === "soft_warning") return "room_capacity_unverified";
  return null;
}

function run() {
  // Schema rename + SHA of applied migration content
  const schemaPath = "supabase/migrations/20260715012000_section_subgroups_capacity_model.sql";
  assert(existsSync(join(root, schemaPath)), "renamed schema present");
  assert(
    !existsSync(
      join(root, "supabase/migrations/20260715030000_section_subgroups_capacity_model.sql"),
    ),
    "old 30000 name gone",
  );
  const schemaBuf = readFileSync(join(root, schemaPath));
  assert(schemaBuf.length === 5732, `schema size ${schemaBuf.length}`);
  assert(
    createHash("sha256").update(schemaBuf).digest("hex") ===
      "5ac0e71bea31d6f6ddcf9fbde113e7b736d1e85b001dbc149dd696d33a028438",
    "schema sha unchanged",
  );

  assert(
    !existsSync(
      join(root, "supabase/migrations/20260715030100_section_subgroups_conflict_rpc.sql"),
    ),
    "30100 removed",
  );

  const compact = readdirSync(migDir)
    .filter((f) => /^2026071501(2[1-9]|3\d|4\d)/.test(f))
    .sort();
  assert(compact.length >= 20, `compact count ${compact.length}`);
  let max = 0;
  for (const f of compact) {
    const buf = readFileSync(join(migDir, f));
    max = Math.max(max, buf.length);
    assert(buf.length <= 1700, `${f} size ${buf.length}`);
    const txt = buf.toString("utf8");
    assert(!/[\u0600-\u06FF]/.test(txt), `${f} has Arabic`);
    assert(!/message_ar|message_en/.test(txt), `${f} has message literals`);
    assert(!/INSERT\s+INTO\s+public\.(section_subgroups|schedule_sessions|rooms)/i.test(txt), f);
    assert(!/NEW-HALL|NEW-LAB|18:00/.test(txt), `${f} banned tokens`);
  }
  assert(max <= 1700, `max ${max}`);

  // Capacity trust equivalence (cases 1–7)
  assert(capacityCode("confirmed", 60, 60) === null, "confirmed within");
  assert(capacityCode("confirmed", 65, 60) === null, "confirmed +5");
  assert(capacityCode("confirmed", 66, 60) === "room_capacity", "confirmed over");
  assert(capacityCode("estimated", 200, 60) === "room_capacity_unverified", "estimated soft");
  assert(capacityCode("unverified", 200, 60) === "room_capacity_unverified", "unverified soft");
  assert(capacityCode("test", 200, 60) === "room_capacity_unverified", "test soft");
  assert(capacityCode("unverified", 0, 60) === null, "nullish/zero ok");

  // Soft never becomes hard in mapper severity contract
  const softItem = enrichConflictMessages({
    code: "room_capacity_unverified",
    severity: "soft",
    metadata: { capacity: 60, expected_students: 200, enrollment_count_status: "test" },
  });
  assert(softItem.severity === "soft", "soft preserved");
  assert(softItem.message_ar.includes("غير معتمد"), "ar soft");

  const hardItem = enrichConflictMessages({
    code: "room_capacity",
    severity: "hard",
    metadata: { capacity: 60, expected_students: 66, enrollment_count_status: "confirmed" },
  });
  assert(hardItem.severity === "hard", "hard preserved");
  assert(hardItem.message_ar.includes("معتمد"), "ar hard");

  // replaced_by_split / subgroup peers (source + helper)
  assert(
    read("supabase/migrations/20260715012700_ss_peer_instructor.sql").includes("replaced_by_split"),
  );
  assert(read("supabase/migrations/20260715012900_ss_peer_section.sql").includes("_ss_sec_hit"));
  assert(
    !sameSectionSubgroupConflict(
      { section_id: "s1", section_subgroup_id: "a" },
      { section_id: "s1", section_subgroup_id: "b" },
    ),
    "different subgroups no section conflict",
  );
  assert(
    sameSectionSubgroupConflict(
      { section_id: "s1", section_subgroup_id: "a" },
      { section_id: "s1", section_subgroup_id: "a" },
    ),
    "same subgroup conflicts",
  );

  // Instructor conflict across subgroups remains (different helpers; peer_i ignores subgroup)
  assert(
    read("supabase/migrations/20260715012700_ss_peer_instructor.sql").includes(
      "instructor_conflict",
    ),
  );

  // Room type / availability / breaks / templates present
  assert(
    read("supabase/migrations/20260715013100_ss_room_type.sql").includes("room_type_mismatch"),
  );
  assert(
    read("supabase/migrations/20260715013200_ss_room_availability.sql").includes(
      "room_availability",
    ),
  );
  assert(read("supabase/migrations/20260715013700_ss_break_conflicts.sql").includes("daily_break"));
  assert(
    read("supabase/migrations/20260715013500_ss_template_conflicts.sql").includes(
      "study_system_time_template",
    ),
  );

  // Collector wires gather+pack; helpers are service_role only
  const collect = read("supabase/migrations/20260715014100_ss_collect_replace.sql");
  assert(collect.includes("_ss_gather") && collect.includes("_ss_pack"), "collect composition");
  assert(collect.includes("REVOKE ALL") && collect.includes("TO service_role"), "collect acl");

  // UI Arabic mapping for codes
  assert(conflictMessageAr("instructor_conflict").includes("المحاضر"), "ui instructor ar");
  assert(conflictMessageAr("room_conflict").includes("القاعة"), "ui room ar");
  assert(conflictMessageAr("STALE_SESSION").includes("تغيرت"), "stale ar");
  assert(conflictMessageAr("VERSION_LOCKED").includes("غير قابلة"), "locked ar");

  // Gates (source): published/archived/stale in wrappers; read_only via can_manage_college
  const wrappers = read("supabase/migrations/20260714010000_schedule_session_move_rpc.sql");
  assert(
    wrappers.includes("VERSION_LOCKED") && wrappers.includes("STALE_SESSION"),
    "wrapper gates",
  );
  assert(wrappers.includes("published") && wrappers.includes("archived"), "version gates");
  assert(wrappers.includes("can_manage_college"), "authz gate");
  const page = read("src/routes/_authenticated/schedule-builder.tsx");
  assert(
    page.includes("read_only") || page.includes("mayEnterEdit") || page.includes("isReadOnly"),
    "ui gate",
  );

  // Warning must not rewrite hard code
  assert(capacityCode("confirmed", 66, 60) !== "room_capacity_unverified", "hard not soft");

  console.log("conflict-rpc-compact-equivalence.harness.ts: PASS");
}

run();
