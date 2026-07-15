/**
 * Build migration that patches move-conflict collector for subgroups.
 */
import fs from "node:fs";

const src = fs.readFileSync(
  "supabase/migrations/20260714012008_a6bb4288-ac48-4681-ad6e-634cf572e904.sql",
  "utf8",
);

const start = src.indexOf(
  "CREATE OR REPLACE FUNCTION public._collect_schedule_session_move_conflicts(",
);
const end = src.indexOf("CREATE OR REPLACE FUNCTION public.validate_schedule_session_move(");
if (start < 0 || end < 0) throw new Error("markers not found");
let fn = src.slice(start, end).replace(/\r\n/g, "\n");

fn = fn.replace(
  /SELECT id, instructor_id, room_id, section_id, day_of_week, start_time, end_time\n\s+FROM public\.schedule_sessions\n\s+WHERE college_id = p_college_id\n\s+AND schedule_version_id = p_version_id\n\s+AND id <> p_session_id/,
  `SELECT id, instructor_id, room_id, section_id, section_subgroup_id, day_of_week, start_time, end_time
    FROM public.schedule_sessions
    WHERE college_id = p_college_id
      AND schedule_version_id = p_version_id
      AND id <> p_session_id
      AND COALESCE(replaced_by_split, false) = false`,
);
if (!fn.includes("replaced_by_split")) {
  throw new Error("peer SELECT patch failed — abort");
}

const sectionOld = `IF p_section_id IS NOT NULL
       AND v_peer.section_id IS NOT NULL
       AND v_peer.section_id = p_section_id
       AND v_peer.day_of_week = p_day_of_week
       AND v_peer.start_time < p_end_time
       AND p_start_time < v_peer.end_time
    THEN`;

const sectionNew = `IF p_section_id IS NOT NULL
       AND v_peer.section_id IS NOT NULL
       AND v_peer.section_id = p_section_id
       AND v_peer.day_of_week = p_day_of_week
       AND v_peer.start_time < p_end_time
       AND p_start_time < v_peer.end_time
       AND (
         v_peer.section_subgroup_id IS NULL
         OR (
           SELECT ss.section_subgroup_id
           FROM public.schedule_sessions ss
           WHERE ss.id = p_session_id
         ) IS NULL
         OR v_peer.section_subgroup_id = (
           SELECT ss.section_subgroup_id
           FROM public.schedule_sessions ss
           WHERE ss.id = p_session_id
         )
       )
    THEN`;

if (!fn.includes(sectionOld)) {
  throw new Error("section conflict IF block not found — abort");
}
fn = fn.replace(sectionOld, sectionNew);

const capOld = `IF v_expected > 0 AND v_room.capacity < v_expected THEN`;
const capNew = `IF v_expected > 0 AND v_room.capacity + 5 < v_expected THEN`;
if (!fn.includes(capOld)) {
  throw new Error("capacity check not found — abort");
}
fn = fn.replace(capOld, capNew);

const out = `-- PHASE-6: subgroup-aware conflict peers for schedule session move RPCs
-- Local migration only — DO NOT auto-apply in agent gates.
-- Depends on: 20260715030000_section_subgroups_capacity_model.sql

${fn}
`;

fs.writeFileSync(
  "supabase/migrations/20260715030100_section_subgroups_conflict_rpc.sql",
  out,
  "utf8",
);
console.log("patched ok", {
  hasReplaced: out.includes("replaced_by_split"),
  hasSubgroup: out.includes("section_subgroup_id"),
  hasPlus5: out.includes("capacity + 5"),
});
