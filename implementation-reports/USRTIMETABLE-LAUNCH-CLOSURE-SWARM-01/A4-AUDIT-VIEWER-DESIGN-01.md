# A4 — AUDIT VIEWER DESIGN 01 (TRACK 7)

**Swarm:** USRTIMETABLE-AUTONOMOUS-SOURCE-CLOSURE-WAVE-03 · **Baseline:** `b6a5a491f9f70f1cfba5dc5696fb33f64dbcee6b`
**Type:** design only. Read-only feature. No DB writes, no migration apply.

---

## 1. Purpose

A first-class, paginated, filterable **Audit Viewer** over `public.audit_logs` so that:
- `super_admin` can answer "who changed what, where, when" across all colleges;
- `college_admin` can review every mutation in their own college;
- `read_only` can read (never write) the same stream for transparency;
- the surface **cannot** mutate audit data (no-write guarantee) and **cannot** leak sensitive payloads.

## 2. Existing backing store (evidence)

`public.audit_logs` — `supabase/migrations/20260604222655_952c4a6f-…sql`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `actor_id` | uuid → auth.users, ON DELETE SET NULL | nullable (actor deleted) |
| `action` | text | e.g. `import_preview`, `import_claim`, `import_commit`, `import_failed`, `move_or_reschedule`, headcount upsert/approve actions |
| `entity` | text | e.g. `schedule_sessions`, `import_<target>` |
| `entity_id` | uuid | nullable |
| `college_id` | uuid → colleges, ON DELETE SET NULL | nullable (global events) |
| `details` | jsonb | free-form; move RPC stores `{before, after, change_reason, approved_exceptions}`; import stores `{mode, manifest, counts}` |
| `created_at` | timestamptz default now() | indexed `idx_audit_logs_created (created_at DESC)`; `idx_audit_logs_actor` |

RLS (`20260604222725_e869fc5e-…sql`):
- `al_select`: `is_super_admin(uid) OR (college_id IS NOT NULL AND user_in_college(uid, college_id))`.
- `al_insert`: `actor_id = auth.uid()`.
- Grants: `SELECT, INSERT` to `authenticated` only. **UPDATE/DELETE were never granted** → append-only at the privilege layer.

Writers observed: import manifest RPCs (`20260718180000`), move RPC (`20260714010000`), headcount RPCs (`20260721180000`, source-only), lifecycle events (via `schedule_version_events`, separate table — see §9).

## 3. Display model (per row)

| UI field | Source | Notes |
|---|---|---|
| Timestamp | `created_at` | localized, relative + absolute tooltip |
| Actor | `actor_id` → `profiles.full_name` / `email`; "deleted user" fallback | join limited to what RLS allows (profiles self+super_admin today — see GAP-A2) |
| Action | `action` | badge; known-action dictionary → Arabic label |
| Entity | `entity` + `entity_id` | deep-link to entity route when known (e.g. `/timetable/$versionId` context, import job) |
| College | `college_id` → `colleges.name` | shown to super_admin; redundant for college_admin (implicit) |
| Before/After summary | `details.before` / `details.after` | rendered as field-level diff (changed keys only, e.g. day/start/end/room for a move) |
| Details summary | remaining `details` keys | compact key/value chips; counts for import (`inserted/updated/skipped/failed`), `manifest` (md5, truncated) |

## 4. Sensitive-data leakage rules (binding)

1. **Never render raw import payloads.** Audit rows only carry `manifest` (md5) + counts today — keep it that way; any future writer must not place row data, emails, or names into `details`.
2. **Redaction list (viewer-enforced):** keys matching `/token|secret|password|apikey|api_key|jwt/i` inside `details` are replaced with `•••` client-side **and** must never be written by producers (producer-side lint in code review).
3. **PII minimization:** actor display = full_name; email shown only to `super_admin`. `raw_value` from `import_errors` is never joined into the viewer.
4. **Cross-college containment:** college_admin/read_only rows are already RLS-contained; the viewer must NOT offer a college selector to non-super_admins (prevents probing for college UUIDs; selector = UX only, RLS is the boundary).
5. **Null-college (global) rows:** visible to super_admin only (matches `al_select`).
6. **No inline entity snapshots beyond before/after diffs:** the viewer never fetches the live entity row for display enrichment beyond a name lookup under RLS.

## 5. Route + query design

**Route:** `src/routes/_authenticated/audit-logs.tsx` → path `/audit-logs` (registered via TanStack file routing; nav entry gated by "authenticated" only — visibility of the nav item is UX, RLS is the boundary).

**Query (read-only, via Supabase PostgREST under existing RLS):**

```ts
// keyset pagination — stable under concurrent appends (audit is append-heavy)
supabase.from("audit_logs")
  .select("id, actor_id, action, entity, entity_id, college_id, details, created_at",
          { count: "exact" })
  .lt("created_at", cursor)                    // cursor = last row of previous page
  .order("created_at", { ascending: false })
  .order("id", { ascending: false })
  .limit(50);
// filters (all optional, composed AND):
//   .gte("created_at", from).lte("created_at", to)
//   .eq("action", action) .eq("entity", entity) .eq("actor_id", actorId)
//   .eq("college_id", collegeId)               // super_admin selector only
```

- **Pagination:** cursor/keyset (NOT offset) — audit tables grow monotonically; offset scans degrade and skip rows under append load.
- **Filters:** date range, action (dictionary-driven dropdown), entity, actor (super_admin), college (super_admin). college_admin/read_only get implicit college scoping from RLS; no client-side college filter is sent.
- **Actor names:** batch-fetch `profiles` for the page's `actor_id`s. NOTE GAP-A2: `prof_select` allows self+super_admin only, so college_admin/read_only cannot resolve colleague names today. Design options: (a) show actor initials/short-id for non-super_admin (AUTO_SAFE, zero schema change) — **chosen for V1**; (b) later add a minimal `actor_display` view with RLS (approval-gated migration).
- **Performance GAP-A1:** no index on `(college_id, created_at DESC)` or `(action)`; fine at current volume (production is near-empty) but the design reserves an approval-gated follow-up index migration. Document, do not apply.

## 6. RLS / authorization posture (per role)

| Role | Reads | Writes via viewer | Enforcement |
|---|---|---|---|
| super_admin | all rows incl. `college_id IS NULL` | none | existing `al_select` + viewer has no mutation code path |
| college_admin | own college rows only | none | existing `al_select` (`user_in_college`) |
| read_only | own college rows only | none | existing `al_select` (read_only ∈ user_in_college) — matches TRACK 7 requirement "read_only read" |

**No-write guarantee (three layers):**
1. Viewer code contains no insert/update/delete call (design constraint, verified in review).
2. `authenticated` has no UPDATE/DELETE grant on `audit_logs` (never granted — `20260604222655`).
3. The only INSERT path is `actor_id = auth.uid()` append (`al_insert`); the viewer never uses it. (Related open decision GAP-6 in the matrix: whether to restrict audit INSERT further — does not affect viewer read safety.)

## 7. UI layout (V1)

- Header: title "سجل التدقيق" + college chip (super_admin: college selector).
- Filter bar: date range, action dropdown (known-action dictionary with Arabic labels), entity dropdown, actor search (super_admin).
- Table: timestamp · actor · action badge · entity (+link) · summary chips; expandable row → before/after diff panel (changed keys only) + redacted details JSON (collapsible).
- Footer: cursor pager (prev/next), page size 50, total count.
- Empty/denied states: "لا توجد سجلات" (RLS-empty is indistinguishable from no-data — acceptable).

## 8. AUTO_SAFE vs approval-gated

- **AUTO_SAFE (later implementation PR):** route, hooks, diff renderer, redaction, keyset pagination, option (a) actor display. Zero schema change; read-only.
- **Approval-gated (NOT in this design's V1):** `(college_id, created_at)` index (GAP-A1); actor display view (GAP-A2 option b); any change to `al_insert` (matrix GAP-6); including `schedule_version_events` as a second source (§9).

## 9. Known gaps / follow-ups

| # | Item | Note |
|---|---|---|
| GAP-A1 | Missing `(college_id, created_at DESC)` / `action` indexes | approval-gated index migration when volume justifies |
| GAP-A2 | `profiles` RLS blocks colleague name resolution for non-super_admin | V1: initials/short-id; later: approval-gated display view |
| GAP-A3 | Lifecycle transitions are logged to `schedule_version_events`, not `audit_logs` | V2 may union both sources in the viewer (read-only; approval-gated if a DB view is preferred) |
| GAP-A4 | No producer registry lint that forbids sensitive keys in `details` | add to code-review checklist / harness (AUTO_SAFE) |
