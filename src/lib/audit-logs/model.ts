import { supabase } from "@/integrations/supabase/client";

/**
 * Audit Viewer read model — READ-ONLY.
 * A4-AUDIT-VIEWER-DESIGN-01: this module contains no insert/update/delete call.
 * Enforcement stays in RLS (`al_select`) + grants (UPDATE/DELETE never granted
 * on public.audit_logs). This file must never gain a mutation path.
 */

export const AUDIT_PAGE_SIZE = 50;

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  college_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogFilters {
  collegeId?: string | null;
  action?: string | null;
  entity?: string | null;
  actorId?: string | null;
  from?: string | null; // ISO date (yyyy-mm-dd)
  to?: string | null; // ISO date (yyyy-mm-dd)
  cursor?: string | null; // created_at of the last row of the previous page (keyset)
}

/** Known-action dictionary → Arabic labels (extend as new writers appear). */
export const KNOWN_AUDIT_ACTIONS: Array<{ value: string; label: string }> = [
  { value: "import_preview", label: "معاينة استيراد" },
  { value: "import_claim", label: "بدء تنفيذ استيراد" },
  { value: "import_commit", label: "تثبيت استيراد" },
  { value: "import_failed", label: "فشل استيراد" },
  { value: "move_or_reschedule", label: "نقل/إعادة جدولة محاضرة" },
  { value: "create", label: "إنشاء" },
  { value: "update", label: "تعديل" },
  { value: "validate", label: "فحص تعارضات" },
];

export function actionLabel(action: string): string {
  return KNOWN_AUDIT_ACTIONS.find((a) => a.value === action)?.label ?? action;
}

/** Design §4.2: viewer-enforced redaction list for sensitive keys. */
export const SENSITIVE_KEY_PATTERN = /token|secret|password|apikey|api_key|jwt/i;
export const REDACTED = "•••";

/** Recursively redact sensitive keys anywhere inside `details`. */
export function redactDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactDetails);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactDetails(v);
    }
    return out;
  }
  return value;
}

export interface DiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Field-level diff (changed keys only), with redaction applied. */
export function diffBeforeAfter(before: unknown, after: unknown): DiffEntry[] {
  if (!isPlainObject(before) || !isPlainObject(after)) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const entries: DiffEntry[] = [];
  for (const field of keys) {
    if (SENSITIVE_KEY_PATTERN.test(field)) continue; // never display sensitive fields at all
    const b = before[field];
    const a = after[field];
    if (JSON.stringify(b ?? null) !== JSON.stringify(a ?? null)) {
      entries.push({ field, before: redactDetails(b ?? null), after: redactDetails(a ?? null) });
    }
  }
  return entries;
}

/** Remaining details keys (excluding before/after) as compact chips, redacted. */
export function summarizeDetails(details: Record<string, unknown> | null): Array<{ key: string; value: string }> {
  if (!details) return [];
  const redacted = redactDetails(details) as Record<string, unknown>;
  return Object.entries(redacted)
    .filter(([key]) => key !== "before" && key !== "after")
    .map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    }));
}

export interface AuditLogsPage {
  rows: AuditLogRow[];
  /** Total matching rows — only requested on the first page (cursor === null). */
  total: number | null;
  nextCursor: string | null;
  error: string | null;
}

/**
 * Keyset (cursor) pagination — never offset. Audit is append-heavy; offset
 * scans degrade and skip rows under concurrent appends (design §5).
 */
export async function fetchAuditLogsPage(filters: AuditLogFilters): Promise<AuditLogsPage> {
  let query = supabase
    .from("audit_logs")
    .select("id, actor_id, action, entity, entity_id, college_id, details, created_at", {
      count: filters.cursor ? undefined : "exact",
    })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(AUDIT_PAGE_SIZE);

  if (filters.cursor) query = query.lt("created_at", filters.cursor);
  if (filters.collegeId) query = query.eq("college_id", filters.collegeId);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.entity) query = query.eq("entity", filters.entity);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00Z`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59.999Z`);

  const { data, error, count } = await query;
  if (error) {
    // RLS-empty and no-data are indistinguishable by design; a hard error here
    // means the query itself failed (e.g. schema drift) — surface it, fail-closed.
    return { rows: [], total: null, nextCursor: null, error: error.message };
  }
  const rows = (data ?? []) as AuditLogRow[];
  return {
    rows,
    total: filters.cursor ? null : (count ?? null),
    nextCursor: rows.length === AUDIT_PAGE_SIZE ? rows[rows.length - 1].created_at : null,
    error: null,
  };
}

export interface ActorProfile {
  full_name: string | null;
  email: string | null;
}

/**
 * Batch-fetch actor profiles for one page. GAP-A2: `prof_select` allows
 * self + super_admin only, so college_admin/read_only cannot resolve
 * colleague names today — unresolved actors fall back to short-id (V1, AUTO_SAFE).
 */
export async function fetchActorProfiles(actorIds: string[]): Promise<Map<string, ActorProfile>> {
  const map = new Map<string, ActorProfile>();
  const ids = Array.from(new Set(actorIds.filter(Boolean)));
  if (ids.length === 0) return map;
  const { data, error } = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
  if (error) return map; // RLS-limited or schema drift → short-id fallback
  for (const row of (data ?? []) as Array<{ id: string } & ActorProfile>) {
    map.set(row.id, { full_name: row.full_name ?? null, email: row.email ?? null });
  }
  return map;
}

/** Actor display: full_name; email shown only to super_admin; short-id fallback. */
export function actorDisplay(
  actorId: string | null,
  profiles: Map<string, ActorProfile>,
  isSuperAdmin: boolean,
): string {
  if (!actorId) return "مستخدم محذوف";
  const profile = profiles.get(actorId);
  const shortId = actorId.slice(0, 8);
  if (!profile) return `…${shortId}`;
  const name = profile.full_name ?? `…${shortId}`;
  if (isSuperAdmin && profile.email) return `${name} (${profile.email})`;
  return name;
}

/** Format a JSON scalar/object for compact display. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
