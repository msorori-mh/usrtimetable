import { z } from "zod";

export const ITCS_DRAFT_ID = "d68d8d22-9a6d-4f21-935f-cebf18bb969b";
export const ITCS_PUBLISHED_ID = "30f8a76d-1cb9-4944-a5d7-483dcaea7692";
export const EXPECTED = { sessions: 282, changed: 272, replacements: 10 } as const;

const time = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const placement = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: time,
  end_time: time,
  room_id: z.string().uuid(),
});
const oldPlacement = placement.extend({
  instructor_id: z.string().uuid().nullable(),
  teaching_assignment_id: z.string().uuid().nullable(),
});

export const manifestSchema = z.object({
  draft_version_id: z.string().uuid(),
  published_version_id: z.string().uuid(),
  college_id: z.string().uuid(),
  term_id: z.string().uuid(),
  sessions: z.array(
    z.object({
      session_id: z.string().uuid(),
      changed: z.boolean(),
      session_type: z.string().optional(),
      old: oldPlacement,
      new: placement,
    }),
  ),
  replacements: z.array(
    z.object({
      replaces: z.string().uuid(),
      instructor: z.string().uuid(),
      hours: z.number().positive(),
      cross_college: z.boolean(),
      request_id: z.string().uuid().nullable().optional(),
    }),
  ),
});
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

/** Structural checks — fail closed on any count/identity mismatch. */
export function validateManifest(raw: unknown): { manifest?: CutoverManifest; errors: string[] } {
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return { errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const m = parsed.data;
  const errors: string[] = [];
  if (m.draft_version_id !== ITCS_DRAFT_ID) errors.push("DRAFT_ID_MISMATCH");
  if (m.published_version_id !== ITCS_PUBLISHED_ID) errors.push("PUBLISHED_ID_MISMATCH");
  const ids = new Set(m.sessions.map((s) => s.session_id));
  if (ids.size !== m.sessions.length) errors.push("DUPLICATE_SESSION_IDS");
  if (m.sessions.length !== EXPECTED.sessions) errors.push(`SESSIONS_${m.sessions.length}_NOT_${EXPECTED.sessions}`);
  const changed = m.sessions.filter((s) => s.changed).length;
  if (changed !== EXPECTED.changed) errors.push(`CHANGED_${changed}_NOT_${EXPECTED.changed}`);
  if (m.replacements.length !== EXPECTED.replacements)
    errors.push(`REPLACEMENTS_${m.replacements.length}_NOT_${EXPECTED.replacements}`);
  if (new Set(m.replacements.map((r) => r.replaces)).size !== m.replacements.length)
    errors.push("DUPLICATE_REPLACEMENTS");
  for (const s of m.sessions) {
    const same =
      s.old.day_of_week === s.new.day_of_week &&
      hm(s.old.start_time) === hm(s.new.start_time) &&
      hm(s.old.end_time) === hm(s.new.end_time) &&
      s.old.room_id === s.new.room_id;
    if (s.changed === same) errors.push(`CHANGED_FLAG_WRONG:${s.session_id}`);
    if (mins(s.new.end_time) <= mins(s.new.start_time)) errors.push(`BAD_INTERVAL:${s.session_id}`);
  }
  return { manifest: errors.length ? undefined : m, errors };
}

/** CAS diff of manifest "old" against the live draft rows. */
export function diffAgainstLive(m: CutoverManifest, live: LiveSession[]) {
  const byId = new Map(live.map((s) => [s.id, s]));
  const missing: string[] = [];
  const drift: string[] = [];
  for (const s of m.sessions) {
    const l = byId.get(s.session_id);
    if (!l) {
      missing.push(s.session_id);
      continue;
    }
    if (
      l.day_of_week !== s.old.day_of_week ||
      hm(l.start_time) !== hm(s.old.start_time) ||
      hm(l.end_time) !== hm(s.old.end_time) ||
      l.room_id !== s.old.room_id ||
      l.instructor_id !== s.old.instructor_id ||
      l.teaching_assignment_id !== s.old.teaching_assignment_id
    )
      drift.push(s.session_id);
  }
  const manifestIds = new Set(m.sessions.map((s) => s.session_id));
  const extra = live.filter((l) => !manifestIds.has(l.id)).map((l) => l.id);
  return { missing, drift, extra, ok: !missing.length && !drift.length && !extra.length };
}

/** Independent local path-rule check of the target placements (mirrors SQL itcs_cutover_path_rules). */
export function targetPathRules(
  m: CutoverManifest,
  groupOf: (sessionId: string) => string | null,
): { theory: string[]; lab: string[]; roomClashes: number; overFourDays: string[]; singleDays: number } {
  const theory: string[] = [];
  const lab: string[] = [];
  const perGroupDay = new Map<string, Map<number, number>>();
  for (const s of m.sessions) {
    const isLab = /lab/i.test(s.session_type ?? "");
    const a = mins(s.new.start_time);
    const b = mins(s.new.end_time);
    if (!isLab && (a < 480 || b > 840)) theory.push(s.session_id);
    if (isLab && (a < 480 || b > 960)) lab.push(s.session_id);
    const g = groupOf(s.session_id);
    if (g) {
      const d = perGroupDay.get(g) ?? new Map<number, number>();
      d.set(s.new.day_of_week, (d.get(s.new.day_of_week) ?? 0) + 1);
      perGroupDay.set(g, d);
    }
  }
  let roomClashes = 0;
  const ss = m.sessions;
  for (let i = 0; i < ss.length; i++)
    for (let j = i + 1; j < ss.length; j++) {
      const x = ss[i]!.new;
      const y = ss[j]!.new;
      if (
        x.room_id === y.room_id &&
        x.day_of_week === y.day_of_week &&
        mins(x.start_time) < mins(y.end_time) &&
        mins(y.start_time) < mins(x.end_time)
      )
        roomClashes++;
    }
  const overFourDays: string[] = [];
  let singleDays = 0;
  for (const [g, d] of perGroupDay) {
    if (d.size > 4) overFourDays.push(g);
    for (const n of d.values()) if (n === 1) singleDays++;
  }
  return { theory, lab, roomClashes, overFourDays, singleDays };
}

export async function sha(text: string): Promise<string> {
  // Server compares md5(p_manifest::text); client sends raw text and lets server hash.
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
