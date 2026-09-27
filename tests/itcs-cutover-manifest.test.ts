import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ITCS_DRAFT_ID,
  ITCS_PUBLISHED_ID,
  buildUnitResolver,
  diffAgainstLive,
  targetPathRules,
  validateManifest,
} from "../src/lib/itcs-cutover/manifest";

const u = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** Fixture in the exact itcs_cutover_manifest_2026-09-28.json shape. */
function build() {
  const sessions = Array.from({ length: 282 }, (_, i) => {
    const day = i % 5;
    const slot = Math.floor(i / 5) % 3;
    const start = `${String(8 + slot * 2).padStart(2, "0")}:00`;
    const end = `${String(10 + slot * 2).padStart(2, "0")}:00`;
    const changed = i < 272;
    const room = u(1000 + Math.floor(i / 15));
    return {
      session_id: u(i + 1), changed, session_type: "lecture",
      old: { day: changed ? (day + 1) % 5 : day, start, end, room, instructor: u(5000), teaching_assignment_id: u(6000 + i) },
      new: { day, start, end, room },
    };
  });
  return {
    term_id: u(9002), draft_version_id: ITCS_DRAFT_ID, published_version_id: ITCS_PUBLISHED_ID, sessions,
    replacements: Array.from({ length: 10 }, (_, i) => ({ replaces: u(6000 + i), instructor: u(7000 + i),
      hours: 2, cross_college: i < 3, request_id: i < 3 ? u(8000 + i) : null })),
  };
}
const live = (m: ReturnType<typeof build>) => m.sessions.map((s) => ({
  id: s.session_id, day_of_week: s.old.day, start_time: s.old.start + ":00", end_time: s.old.end + ":00",
  room_id: s.old.room, instructor_id: s.old.instructor, teaching_assignment_id: s.old.teaching_assignment_id }));

describe("ITCS cutover manifest (2026-09-28 shape)", () => {
  it("accepts 282/272/10/3 with zero drift", () => {
    const m = build(); const v = validateManifest(m);
    expect(v.errors).toEqual([]);
    const d = diffAgainstLive(v.manifest!, live(m));
    expect(d.ok).toBe(true); expect(d.atTarget).toBe(10);
  });
  it("rejects the old recovery-file shape", () => {
    const m = build() as unknown as { sessions: { old: Record<string, unknown> }[] };
    m.sessions[0]!.old = { day_of_week: 1, start_time: "08:00", end_time: "10:00", room_id: u(1) };
    expect(validateManifest(m).manifest).toBeUndefined();
  });
  it("fails closed on counts, ids, duplicates, flags, cross-college count", () => {
    const a = build(); a.sessions.pop(); expect(validateManifest(a).errors.join()).toMatch(/SESSIONS_281/);
    const b = build(); b.draft_version_id = u(1); expect(validateManifest(b).errors).toContain("DRAFT_ID_MISMATCH");
    const c = build(); c.sessions[1]!.session_id = c.sessions[0]!.session_id;
    expect(validateManifest(c).errors).toContain("DUPLICATE_SESSION_IDS");
    const d = build(); d.sessions[281]!.changed = true; expect(validateManifest(d).manifest).toBeUndefined();
    const e = build(); e.replacements[5]!.cross_college = true; expect(validateManifest(e).errors.join()).toMatch(/CROSS_COLLEGE_4/);
    const f = build(); f.replacements[0]!.replaces = u(99999); expect(validateManifest(f).errors.join()).toMatch(/REPLACEMENT_NOT_IN_SESSIONS/);
  });
  it("accepts a home-college-applied scoped replacement, rejects other drift", () => {
    const m = build(); const v = validateManifest(m).manifest!; const l = live(m);
    l[0]!.teaching_assignment_id = u(7777); l[0]!.instructor_id = u(7000);
    expect(diffAgainstLive(v, l).drift).toEqual([u(1)]);
    const scoped = new Map([[u(6000), { assignment_id: u(7777), instructor_id: u(7000) }]]);
    expect(diffAgainstLive(v, l, scoped).ok).toBe(true);
    l[1]!.room_id = u(4242); l.pop();
    const d = diffAgainstLive(v, l, scoped);
    expect(d.drift).toEqual([u(2)]); expect(d.missing).toEqual([u(282)]);
  });
  it("student units: common lecture reaches linked partitions; parallel groups of different partitions do not clash", () => {
    const m = build(); const v = validateManifest(m).manifest!;
    const s = (id: number, day: number, start: string, end: string) =>
      ({ ...v.sessions[0]!, session_id: u(id), changed: true, new: { day, start, end, room: u(2000 + id) } });
    const small = { ...v, sessions: [s(1, 0, "08:00", "10:00"), s(2, 0, "10:00", "12:00"), s(3, 0, "10:00", "12:00")] };
    const groups = new Map([[u(1), { delivery_group_id: "G1", cohort_id: "C" }],
      [u(2), { delivery_group_id: "G3", cohort_id: "C" }], [u(3), { delivery_group_id: "G4", cohort_id: "C" }]]);
    const parts = new Map([["G1", ["P1"]], ["G2", ["P2"]], ["G3", ["P1"]], ["G4", ["P2"]]]);
    const units = buildUnitResolver(groups, parts, [{ member_group_id: "G2", anchor_group_id: "G1" }]);
    expect(units(u(1)).sort()).toEqual(["p:P1", "p:P2"]);
    const r = targetPathRules(small, units);
    expect(r.studentClashes).toBe(0); expect(r.singleDays).toBe(0);
    small.sessions[1]!.new.start = "08:00"; small.sessions[1]!.new.end = "10:00";
    expect(targetPathRules(small, units).studentClashes).toBe(1);
  });
  it("orchestrator SQL: staged, no request loop over cross-college, real quality run, archive, no bypass", () => {
    const sql = readFileSync("docs/migrations-proposed/20260927c_itcs_cutover_orchestrator.sql", "utf8");
    for (const t of ["SUPER_ADMIN_REQUIRED", "MANIFEST_HASH_MISMATCH", "MANIFEST_LIVE_MISMATCH",
      "CROSS_COLLEGE_HOME_DECISION_PENDING", "submit_version_scoped_teaching_request", "WHERE NOT z2.cross_college",
      "QUALITY_RUN_REQUIRED_AT_CURRENT_REVISION", "'published', 'archived'", "PUBLISHED_HISTORY_CHANGED",
      "PUBLISHED_VERSION_COUNT_", "lock_timeout", "replayed", "'approved', 'published'"])
      expect(sql).toContain(t);
    expect(sql).not.toMatch(/DISABLE TRIGGER|session_replication_role|decide_faculty_teaching_request\(/i);
    expect(sql).not.toMatch(/delivery_groups_share_students/);
    let depth = 0;
    for (const ch of sql.replace(/'[^']*'/g, "").replace(/--.*$/gm, "")) { if (ch === "(") depth++; if (ch === ")") depth--; expect(depth).toBeGreaterThanOrEqual(0); }
    expect(depth).toBe(0);
  });
});
