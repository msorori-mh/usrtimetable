import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ITCS_DRAFT_ID,
  ITCS_PUBLISHED_ID,
  diffAgainstLive,
  targetPathRules,
  validateManifest,
} from "../src/lib/itcs-cutover/manifest";

const u = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
function build() {
  const sessions = Array.from({ length: 282 }, (_, i) => {
    const day = i % 5;
    const slot = Math.floor(i / 5) % 3;
    const st = `${String(8 + slot * 2).padStart(2, "0")}:00`;
    const et = `${String(10 + slot * 2).padStart(2, "0")}:00`;
    const changed = i < 272;
    const room = u(1000 + Math.floor(i / 15));
    return {
      session_id: u(i + 1),
      changed,
      old: { day_of_week: changed ? (day + 1) % 5 : day, start_time: st, end_time: et, room_id: room,
             instructor_id: u(5000), teaching_assignment_id: u(6000 + i) },
      new: { day_of_week: day, start_time: st, end_time: et, room_id: room },
    };
  });
  return {
    draft_version_id: ITCS_DRAFT_ID, published_version_id: ITCS_PUBLISHED_ID,
    college_id: u(9001), term_id: u(9002), sessions,
    replacements: Array.from({ length: 10 }, (_, i) => ({ replaces: u(6000 + i), instructor: u(7000 + i),
      hours: 2, cross_college: i < 3, request_id: i < 3 ? u(8000 + i) : null })),
  };
}
const live = (m: ReturnType<typeof build>) =>
  m.sessions.map((s) => ({ id: s.session_id, ...s.old }));

describe("ITCS cutover manifest", () => {
  it("accepts a complete 282/272/10 manifest with zero drift", () => {
    const m = build();
    const v = validateManifest(m);
    expect(v.errors).toEqual([]);
    expect(diffAgainstLive(v.manifest!, live(m)).ok).toBe(true);
  });
  it("fails closed on wrong counts, ids, duplicates and changed flags", () => {
    const a = build(); a.sessions.pop();
    expect(validateManifest(a).errors.join()).toMatch(/SESSIONS_281/);
    const b = build(); b.draft_version_id = u(1);
    expect(validateManifest(b).errors).toContain("DRAFT_ID_MISMATCH");
    const c = build(); c.sessions[1]!.session_id = c.sessions[0]!.session_id;
    expect(validateManifest(c).errors).toContain("DUPLICATE_SESSION_IDS");
    const d = build(); d.sessions[281]!.changed = true;
    expect(validateManifest(d).manifest).toBeUndefined();
    const e = build(); e.replacements.pop();
    expect(validateManifest(e).errors.join()).toMatch(/REPLACEMENTS_9/);
  });
  it("detects live drift, missing and extra sessions", () => {
    const m = build(); const v = validateManifest(m).manifest!;
    const l = live(m); l[0]!.room_id = u(4242); l.pop(); l.push({ ...l[1]!, id: u(99999) });
    const d = diffAgainstLive(v, l);
    expect(d.drift).toEqual([u(1)]); expect(d.missing).toEqual([u(282)]); expect(d.extra).toEqual([u(99999)]);
    expect(d.ok).toBe(false);
  });
  it("path rules flag theory after 14:00, lab after 16:00 and room clashes", () => {
    const m = build(); const v = validateManifest(m).manifest!;
    v.sessions[0]!.new.end_time = "15:00";
    v.sessions[1]!.session_type = "lab"; v.sessions[1]!.new.end_time = "16:30";
    v.sessions[2]!.new = { ...v.sessions[3]!.new };
    const r = targetPathRules(v, () => null);
    expect(r.theory).toContain(u(1)); expect(r.lab).toContain(u(2)); expect(r.roomClashes).toBeGreaterThan(0);
  });
  it("path rules flag >4 student days and single-lecture days", () => {
    const m = build(); const v = validateManifest(m).manifest!;
    const r = targetPathRules(v, () => "G");
    expect(r.overFourDays).toEqual(["G"]);
    const one = targetPathRules({ ...v, sessions: v.sessions.slice(0, 1) }, () => "H");
    expect(one.singleDays).toBe(1);
  });
  it("orchestrator SQL keeps guards: super admin, CAS, no trigger bypass, official transitions", () => {
    const sql = readFileSync("docs/migrations-proposed/20260927c_itcs_cutover_orchestrator.sql", "utf8");
    for (const s of ["SUPER_ADMIN_REQUIRED", "MANIFEST_HASH_MISMATCH", "MANIFEST_LIVE_MISMATCH",
      "CROSS_COLLEGE_APPROVAL_PENDING", "PUBLISHED_HISTORY_CHANGED", "PATH_RULES_FAILED",
      "begin_schedule_quality_snapshot", "'draft', 'review'", "'review', 'approved'", "'approved', 'published'"])
      expect(sql).toContain(s);
    expect(sql).not.toMatch(/DISABLE TRIGGER|session_replication_role|decide_faculty_teaching_request\(/i);
  });
});
