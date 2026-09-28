import { z } from "zod";

export const ITCS_DRAFT_ID = "258f6f60-539e-43e1-a4bb-f0b07c20c9ab";
export const ITCS_PUBLISHED_ID = "d68d8d22-9a6d-4f21-935f-cebf18bb969b";
export const MANIFEST_FILE = "itcs_cutover_manifest_2026-09-28.json";
export const EXPECTED = {
  sessions: 282,
  changed: 279,
  replacements: 8,
  crossCollege: 8,
  publishedSessions: 282,
} as const;

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const uuid = z.string().uuid();
const placement = z.object({
  day: z.number().int().min(0).max(6),
  start: time,
  end: time,
  room: uuid,
});
const oldPlacement = placement.extend({
  instructor: uuid.nullable(),
  teaching_assignment_id: uuid.nullable(),
});

/** Exact shape of itcs_cutover_manifest_2026-09-28.json (unknown extra keys are kept). */
export const manifestSchema = z
  .object({
    term_id: uuid,
    draft_version_id: uuid,
    published_version_id: uuid,
    sessions: z.array(
      z
        .object({
          session_id: uuid,
          changed: z.boolean(),
          session_type: z.string().nullable().optional(),
          old: oldPlacement,
          new: placement,
        })
        .passthrough(),
    ),
    replacements: z.array(
      z
        .object({
          replaces: uuid,
          instructor: uuid,
          hours: z.number().positive(),
          cross_college: z.boolean(),
          request_id: uuid.nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type CutoverManifest = z.infer<typeof manifestSchema>;

export interface LiveSession {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  room_id: string | null;
  instructor_id: string | null;
  teaching_assignment_id: string | null;
}

const hm = (t: string) => t.slice(0, 5);
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const isLab = (t?: string | null) => /lab|practical|عملي/i.test(t ?? "");

/** Structural checks — fail closed on any count/identity mismatch. */
export function validateManifest(raw: unknown): { manifest?: CutoverManifest; errors: string[] } {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success)
    return {
      errors: parsed.error.issues.slice(0, 50).map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  const m = parsed.data;
  const errors: string[] = [];
  if (m.draft_version_id !== ITCS_DRAFT_ID) errors.push("DRAFT_ID_MISMATCH");
  if (m.published_version_id !== ITCS_PUBLISHED_ID) errors.push("PUBLISHED_ID_MISMATCH");
  if (new Set(m.sessions.map((s) => s.session_id)).size !== m.sessions.length)
    errors.push("DUPLICATE_SESSION_IDS");
  if (m.sessions.length !== EXPECTED.sessions)
    errors.push(`SESSIONS_${m.sessions.length}_NOT_${EXPECTED.sessions}`);
  const changed = m.sessions.filter((s) => s.changed).length;
  if (changed !== EXPECTED.changed) errors.push(`CHANGED_${changed}_NOT_${EXPECTED.changed}`);
  if (m.replacements.length !== EXPECTED.replacements)
    errors.push(`REPLACEMENTS_${m.replacements.length}_NOT_${EXPECTED.replacements}`);
  const cross = m.replacements.filter((r) => r.cross_college).length;
  if (cross !== EXPECTED.crossCollege)
    errors.push(`CROSS_COLLEGE_${cross}_NOT_${EXPECTED.crossCollege}`);
  if (new Set(m.replacements.map((r) => r.replaces)).size !== m.replacements.length)
    errors.push("DUPLICATE_REPLACEMENTS");
  const oldTa = new Set(m.sessions.map((s) => s.old.teaching_assignment_id));
  for (const r of m.replacements)
    if (!oldTa.has(r.replaces)) errors.push(`REPLACEMENT_NOT_IN_SESSIONS:${r.replaces}`);
  for (const s of m.sessions) {
    const same =
      s.old.day === s.new.day &&
      hm(s.old.start) === hm(s.new.start) &&
      hm(s.old.end) === hm(s.new.end) &&
      s.old.room === s.new.room;
    if (s.changed === same) errors.push(`CHANGED_FLAG_WRONG:${s.session_id}`);
    if (mins(s.new.end) <= mins(s.new.start)) errors.push(`BAD_INTERVAL:${s.session_id}`);
    if (mins(s.new.end) - mins(s.new.start) !== mins(s.old.end) - mins(s.old.start))
      errors.push(`DURATION_CHANGED:${s.session_id}`);
  }
  return { manifest: errors.length ? undefined : m, errors };
}

/**
 * CAS diff of manifest "old" against the live draft. A session whose old
 * assignment was already replaced in this version (home-college decision) is
 * accepted when it carries the scoped assignment/instructor and old placement.
 */
export function diffAgainstLive(
  m: CutoverManifest,
  live: LiveSession[],
  scoped: Map<string, { assignment_id: string; instructor_id: string }> = new Map(),
) {
  const byId = new Map(live.map((s) => [s.id, s]));
  const missing: string[] = [];
  const drift: string[] = [];
  let atTarget = 0;
  for (const s of m.sessions) {
    const l = byId.get(s.session_id);
    if (!l) {
      missing.push(s.session_id);
      continue;
    }
    const sc = s.old.teaching_assignment_id ? scoped.get(s.old.teaching_assignment_id) : undefined;
    const ta = sc ? sc.assignment_id : s.old.teaching_assignment_id;
    const ins = sc ? sc.instructor_id : s.old.instructor;
    const at = (p: { day: number; start: string; end: string; room: string }) =>
      l.day_of_week === p.day &&
      hm(l.start_time) === hm(p.start) &&
      hm(l.end_time) === hm(p.end) &&
      l.room_id === p.room;
    if (at(s.new)) atTarget++;
    if (l.teaching_assignment_id !== ta || l.instructor_id !== ins || !(at(s.old) || at(s.new)))
      drift.push(s.session_id);
  }
  const ids = new Set(m.sessions.map((s) => s.session_id));
  const extra = live.filter((l) => !ids.has(l.id)).map((l) => l.id);
  return { missing, drift, extra, atTarget, ok: !missing.length && !drift.length && !extra.length };
}

/** Student units per session: active partitions of the group and of every linked shared-lecture group. */
export function buildUnitResolver(
  groupOfSession: Map<string, { delivery_group_id: string | null; cohort_id: string | null }>,
  partitionsOfGroup: Map<string, string[]>,
  links: { member_group_id: string; anchor_group_id: string }[],
) {
  const anchorOf = new Map(links.map((l) => [l.member_group_id, l.anchor_group_id]));
  const members = new Map<string, string[]>();
  for (const l of links)
    members.set(l.anchor_group_id, [...(members.get(l.anchor_group_id) ?? []), l.member_group_id]);
  return (sessionId: string): string[] => {
    const g = groupOfSession.get(sessionId);
    if (!g) return [];
    if (!g.delivery_group_id) return g.cohort_id ? [`c:${g.cohort_id}`] : [];
    const a = anchorOf.get(g.delivery_group_id) ?? g.delivery_group_id;
    const groups = new Set([g.delivery_group_id, a, ...(members.get(a) ?? [])]);
    const units = new Set<string>();
    for (const x of groups) {
      const ps = partitionsOfGroup.get(x);
      if (ps?.length) ps.forEach((p) => units.add(`p:${p}`));
      else units.add(`g:${x}`);
    }
    return [...units];
  };
}

/** Independent local path-rule check of target placements (mirrors SQL itcs_cutover_path_rules). */
export function targetPathRules(m: CutoverManifest, unitsOf: (sessionId: string) => string[]) {
  const theory: string[] = [];
  const lab: string[] = [];
  const unitDay = new Map<string, Map<number, string[]>>();
  const noUnits: string[] = [];
  const incomplete = new Set<string>();
  for (const s of m.sessions) {
    const a = mins(s.new.start),
      b = mins(s.new.end);
    if (!isLab(s.session_type) && (a < 480 || b > 840)) theory.push(s.session_id);
    if (isLab(s.session_type) && (a < 480 || b > 960)) lab.push(s.session_id);
    const all = unitsOf(s.session_id);
    if (!all.length) noUnits.push(s.session_id);
    // Rev6: only partition units are complete student paths; g:/c: fallbacks fail closed.
    for (const u of all) if (!u.startsWith("p:")) incomplete.add(u);
    const us = all.filter((u) => u.startsWith("p:"));
    for (const u of us) {
      const d = unitDay.get(u) ?? new Map<number, string[]>();
      d.set(s.new.day, [...(d.get(s.new.day) ?? []), s.session_id]);
      unitDay.set(u, d);
    }
  }
  const byId = new Map(m.sessions.map((s) => [s.session_id, s.new]));
  const overlap = (x: string, y: string) => {
    const p = byId.get(x)!,
      q = byId.get(y)!;
    return mins(p.start) < mins(q.end) && mins(q.start) < mins(p.end);
  };
  let roomClashes = 0;
  const ss = m.sessions;
  for (let i = 0; i < ss.length; i++)
    for (let j = i + 1; j < ss.length; j++)
      if (
        ss[i]!.new.room === ss[j]!.new.room &&
        ss[i]!.new.day === ss[j]!.new.day &&
        overlap(ss[i]!.session_id, ss[j]!.session_id)
      )
        roomClashes++;
  const overFourDays: string[] = [];
  let singleDays = 0;
  const singleDetail: { unit: string; day: number; session: string }[] = [];
  const clashDetail: { unit: string; a: string; b: string }[] = [];
  const clashPairs = new Set<string>();
  for (const [u, d] of unitDay) {
    if (d.size > 4) overFourDays.push(u);
    for (const list of d.values()) {
      if (list.length === 1) {
        singleDays++;
        singleDetail.push({
          unit: u,
          day: [...d.entries()].find(([, l]) => l === list)![0],
          session: list[0]!,
        });
      }
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          if (overlap(list[i]!, list[j]!)) {
            clashPairs.add([list[i], list[j]].sort().join("|"));
            clashDetail.push({ unit: u, a: list[i]!, b: list[j]! });
          }
    }
  }
  return {
    theory,
    lab,
    roomClashes,
    overFourDays,
    singleDays,
    studentClashes: clashPairs.size,
    noUnits,
    incompleteUnits: [...incomplete],
    singleDetail,
    clashDetail,
  };
}
