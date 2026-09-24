# A3 — Time & Availability: Gap Analysis + Implementation Plan

- **Swarm:** USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01 (TRACK 3)
- **Agent:** AGENT-TIME-AVAILABILITY-A3
- **Base:** `origin/main` @ `7d738204c7824e12668d017d4c3de4f0d0af1f55` (mission stated `b6a5a49`; main had advanced at review time — all file evidence below was read at the `7d738204` head)
- **Scope:** review + design docs only. **No migration was applied. No DB writes were made.** Everything below is derived from source in the repo.

---

## 1. Current-state inventory

### 1.1 Time sources (A3.1)

| Object | Kind | Created in | Consumers (verified by reading source) | Notes |
|---|---|---|---|---|
| `time_slots` | table | `supabase/migrations/20260604230713_94c6fd6a-....sql` | **Only** `src/routes/_authenticated/time-slots.tsx` ("فترات الجدول اليدوية" — manual/advanced) | Per-day manual slots. **Not** read by any `_ss_*` conflict function inspected, **not** read by the auto-scheduler (`src/lib/auto-scheduler/greedy.ts`). |
| `time_slot_templates` | table | `supabase/migrations/20260605011516_481f5339-....sql` | `src/routes/_authenticated/time-slot-templates.tsx`; `_ss_tmpl` (`20260715013500_ss_template_conflicts.sql`, HARD conflict `study_system_time_template`); `greedy.ts` `buildCandidates()` | Study-system aware (`regular`/`parallel`/`both`), `slot_duration_minutes`, `is_active`. No DB uniqueness constraint observed (dedupe is UI-level only). |
| `scheduling_settings` | table | `20260604235253_296334b2-....sql` (+ `allowed_session_durations` in `20260605001512_5e0e8801-....sql`) | `scheduling-settings.tsx`; `_ss_set` (`20260715013600_ss_settings_conflicts.sql` → HARD `outside_working_days` / `outside_working_hours`); `greedy.ts` fallback windows; `_availability_active_working_days()` in 20260720120000 | Holds `working_days`, `day_start_time`, `day_end_time`, `slot_minutes` **and** structural rules (`min/max_session_hours`, `max_daily_hours_per_instructor/section`, `break_between_sessions_min`, `allow_back_to_back`). One row mixes operational calendar + structural constraint data. |
| `daily_breaks` (الاستراحات) | table | `20260605001512_5e0e8801-....sql` | `daily-breaks.tsx`; `_ss_brk` (`20260715013700_ss_break_conflicts.sql` → HARD `daily_break`) | `name`, `days int[]`, `start_time`, `end_time`, `affects_scheduling`. Single, clean home for named breaks. |

**Dual time source confirmed:** `time_slots` and `time_slot_templates` coexist as tables **and** as UI routes. The engine and solver use **only** `time_slot_templates` (with `scheduling_settings` day-window fallback). `time_slots` is write/read by its own route only.

### 1.2 Unavailability / preferences (A3.2, A3.3)

| Object | Kind | Created in | Consumers | Notes |
|---|---|---|---|---|
| `instructor_availability` | table | `20260604230713_94c6fd6a-....sql`; `is_preference` added in `20260605011516_481f5339-....sql` | `availability.tsx`; `_ss_iavail_req` / `_ss_iavail_win` (`20260715013300/20260715013400`); `greedy.ts` | `availability_type` ∈ `available`/`unavailable`; `is_preference` bool. Engine semantics: hard rows (`is_preference=false`) of type `available` act as a **positive whitelist** when any exist for an instructor+day (`_ss_iavail_win`); `unavailable` rows act as blacklist. Soft rows (`is_preference=true`) are consumed by `greedy.ts` candidate scoring only. |
| `room_unavailability` | table | `20260604230713_94c6fd6a-....sql` | `availability.tsx`; `_ss_room_unav` | Day-of-week or date-range blocks. Blacklist-only — matches A3.2. |
| `room_availability` | table | `20260605000554_0c4cd895-....sql` | `_ss_room_av` (`20260715013200_ss_room_availability.sql`) | **Positive whitelist** for rooms, enforced as HARD when rows exist. **Violates A3.2** ("resource available by default", "no room-availability tabulation") at schema + engine level. Current `availability.tsx` does **not** expose a room-availability tab (UI side already conforms). |
| Soft preferences UI | — | — | — | **None found.** `availability.tsx` writes HARD unavailability only (`src/lib/availability/bulk-api.ts`: "Always HARD unavailable"). Schema (`is_preference=true`) and solver (`greedy.ts`) support soft prefs; entry UI is missing. |

### 1.3 Structural constraints (A3.4)

| Object | Kind | Created in | Consumers | Notes |
|---|---|---|---|---|
| `constraint_types` + `college_constraint_settings` | tables | `20260605012358_2eaafd07-....sql` | `constraint-settings.tsx`; conflict engine | Seeds mix HARD (instructor/room double-booking, instructor availability, room availability, daily breaks…) and SOFT (`preferred_days`, `workload_balance`, `gap_penalty`…) toggleable constraint definitions. |
| `quality_metrics` + `college_quality_settings` | tables | `20260605020637_c025bcf6-....sql` | scorer (`src/lib/conflict-engine/scorer.ts` — referenced, not read) | Soft quality scoring weights. |
| structural fields inside `scheduling_settings` | columns | see 1.1 | `_ss_set`, `greedy.ts` | `min/max_session_hours`, `max_daily_hours_*`, `break_between_sessions_min`, `allow_back_to_back` are structural rules living in the operational-calendar row → structural data has **two homes**. |

### 1.4 RPC layer under review (source-only)

`supabase/migrations/20260720120000_source_only_availability_all_active_days.sql` defines:
- `public._availability_active_working_days(uuid)` → resolves `scheduling_settings.working_days` (fallback `ARRAY[6,0,1,2,3,4]`, Fri off), `service_role` only.
- `public._availability_times_overlap(time,time,time,time)` → pure SQL immutable overlap test.
- `public.upsert_instructor_unavailability_for_active_days(uuid,time,time,text,int)` → HARD instructor unavailability, single day or all active days.
- `public.upsert_room_unavailability_for_active_days(uuid,time,time,text,date,date,int)` → HARD room unavailability, single day or all active days.

Marked `SOURCE-ONLY / NOT APPLIED` in-file; corroborated by `implementation-reports/AVAILABILITY-ALL-ACTIVE-DAYS-BULK-ENTRY-01.md`.

**Drift risk:** the UI **already calls these RPCs** — `src/lib/availability/bulk-api.ts` invokes `upsert_instructor_unavailability_for_active_days` and `upsert_room_unavailability_for_active_days`, and `availability.tsx` routes its bulk entry through them. Until the migration is applied, those UI paths fail at runtime (RPC not found). No client-side fallback was observed in the files read.

---

## 2. Verdict on 20260720120000 (SOURCE ONLY — NOT APPLIED)

**Verdict: PASS — it correctly implements "all active days atomic, no all-marker storage", HARD-only, and available-by-default. Keep it SOURCE ONLY; recommend applying it as-is (approval-gated step) to close the UI/RPC drift.**

Evidence from the file itself:

1. **Atomic all-active-days.** `p_day_of_week IS NULL` → `v_days := _availability_active_working_days(v_college)`; a **pre-validation loop over ALL days** (exact-match skip + overlap conflict check) runs **before any INSERT**; all inserts happen in the same function (single transaction). Any exception (`availability_overlap` / `unavailability_overlap`, invalid input, access denied) rolls back everything. No partial multi-day write is possible.
2. **No "all" marker row.** Only concrete per-day rows are ever inserted (`day_of_week` in INSERTs comes from `v_days`, always ints 0–6). The "all" choice is recorded **only** in `audit_logs.details.mode = 'all_active_days'` — audit metadata, not an availability row. No sentinel (NULL / -1) is persisted.
3. **HARD only.** Instructor path hardcodes `v_type := 'unavailable'`, `v_pref := false`; room path has no type/preference concept at all. Header comment: "never 'available'/'preferred'/Soft". No `'available'` rows are created → **resource available by default** holds.
4. **Duplicate/overlap safety.** Exact-match rows are counted `days_unchanged` (idempotent re-runs); overlapping hard rows with different times/types are rejected pre-DML.
5. **Security.** `auth.uid()` required; resource `is_active` enforced; `can_manage_college(actor, college)` gate inside each function; `SECURITY DEFINER` with `SET search_path = public, pg_temp`; EXECUTE granted to `authenticated`/`service_role`, helpers restricted appropriately.

Minor observations (non-blocking, document-only):
- **O1.** Room overlap pre-check ignores legacy `room_unavailability` rows with NULL `start_time`/`end_time` (date-range-only blocks); a new timed block overlapping such a legacy block won't be flagged. Consistent with scope, worth a comment.
- **O2.** Instructor pre-check also flags overlap with legacy positive `'available'` whitelist rows (`is_preference=false`, different times) as `availability_overlap` — prevents contradictory hard data, but couples the new path to legacy whitelist semantics (see G6).
- **O3.** `audit_logs` insert inside a `SECURITY DEFINER` function bypasses RLS — intended; action/entity naming (`create` / `instructor_unavailability`) should be kept stable for audit queries.
- **O4.** The migration being unapplied while the UI calls its RPCs is the only real defect — and it is an **application-state** defect, not a code defect (see G7).

---

## 3. `time_slots` vs `time_slot_templates` — decision

**Decision: `time_slot_templates` is the single source of truth for the schedulable weekly grid. `time_slots` is legacy and should be deprecated, then dropped after a data audit.**

Evidence:
- Conflict engine: `_ss_tmpl` (`20260715013500_ss_template_conflicts.sql`) validates sessions against `time_slot_templates` (HARD `study_system_time_template`). No inspected `_ss_*` function reads `time_slots` (`_ss_set`, `_ss_brk`, `_ss_room_av`, `_ss_iavail_*`, `_ss_tmpl` all read).
- Solver: `src/lib/auto-scheduler/greedy.ts` `buildCandidates()` generates candidate slots from `time_slot_templates` (falling back to `scheduling_settings` day window + `slot_minutes`). It never queries `time_slots`.
- UI: `time-slots.tsx` itself labels the page "فترات الجدول اليدوية" (manual/advanced) and points users to time-slot-templates for weekly setup — i.e., the product already treats templates as primary.
- Templates are strictly more expressive: `study_system` scoping (regular/parallel/both), `slot_duration_minutes`, `is_active`.

Single-source-of-truth recommendation:
1. Declare `time_slot_templates` the only grid source (docs, this report).
2. Add a DB uniqueness constraint on `time_slot_templates(college_id, study_system, day_of_week, start_time, end_time)` (source-only migration; dedupe is currently UI-only).
3. Make `time-slots.tsx` read-only/deprecated banner → later remove route from nav.
4. After repo-wide grep + DB data audit (no live rows / no hidden consumers), `DROP TABLE time_slots` — approval-gated.

**UNKNOWN:** GitHub code search returned zero results for every query in this environment (repo appears unindexed), so a full-text sweep of the largest uninspected migrations (`20260714010000`, `20260714012008`, `20260716233716`, `20260717035611`, `20260717093000`, `20260718210000`) and of `src/lib/conflict-engine/validator.ts` / `scorer.ts` for `time_slots` references was **not** possible. Mandatory grep before any DROP.

---

## 4. Gap analysis vs requirements

### A3.1 — Time Source of Truth
- **G1 (dual time sources):** `time_slots` vs `time_slot_templates` — resolved by Section 3 decision. **OPEN.**
- **G2 (mixed homes):** operational calendar + structural rules co-located in `scheduling_settings`; structural rules also in `college_constraint_settings`. Overlap/drift risk between `slot_minutes`/session-duration bounds and template durations. **OPEN (docs-first).**
- **G3 (breaks):** `daily_breaks` is a clean single home for named breaks (الاستراحات) — **CONFORMING**. Note: `scheduling_settings.break_between_sessions_min` is a *different* rule (gap between consecutive sessions), not a named break — must be documented as structural to avoid being mistaken for a second breaks source. **OPEN (docs).**
- **G4 (template integrity):** no DB uniqueness on `time_slot_templates` → duplicate grid rows possible → dual-effective time definitions. **OPEN.**

### A3.2 — Resource Unavailability (HARD only, available by default)
- **G5 (room whitelist):** `room_availability` positive-whitelist table + `_ss_room_av` HARD enforcement = room-availability tabulation. UI already conforms (no such tab in `availability.tsx`); schema+engine do not. **OPEN — top gap.**
- **G6 (instructor whitelist semantics):** legacy `availability_type='available'` hard rows act as positive whitelist in `_ss_iavail_win`, contradicting "available by default" whenever such rows exist. New RPC path never creates them, but legacy rows/UI may. **OPEN.**
- **G7 (unapplied RPCs):** 20260720120000 source-only while UI calls it → runtime failure + the A3.2-conformant write path not live. **OPEN — top gap.**
- **G8 (all-active-days atomic / no marker):** implemented correctly in source (Section 2) and UI passes `null` day for "كل أيام الدوام" (`bulk-api.ts`), sentinel never persisted. **CONFORMING in source; pending G7 to be live.**

### A3.3 — Scheduling Preferences (SOFT only, independent)
- **G9 (no soft-pref UI):** schema (`instructor_availability.is_preference=true`) and solver (`greedy.ts` scoring, +5/−10/−3 weights) support soft prefs, but no UI writes them; `availability.tsx` is HARD-only. **OPEN.**
- **G10 (two soft homes):** per-resource soft data (`instructor_availability` soft rows) vs global soft toggles/weights (`college_constraint_settings` seeds like `preferred_days`, `workload_balance`, `gap_penalty`; `college_quality_settings`). Independent of unavailability today (separate flag, separate tables) — **CONFORMING structurally**, needs an ownership doc to stay that way. **OPEN (docs).**

### A3.4 — Structural Constraints (structural only, no overlap)
- **G11 (structural split-brain):** structural rules live in both `scheduling_settings` columns and `college_constraint_settings`; severity toggles can reclassify constraint types (hard↔soft) via `constraint-settings.tsx`, risking structural rules being demoted to soft or vice versa. **OPEN (docs + policy).**
- Positive: engine hard checks (`_ss_set` outside working days/hours, `_ss_brk` breaks, `_ss_tmpl` templates) are structurally separate from soft scoring — **mostly CONFORMING** at engine level.

---

## 5. Implementation plan (ordered; nothing executed by this track)

| # | Action | Files / migrations to create | Gate |
|---|---|---|---|
| P1 | Adopt this report; declare `time_slot_templates` the single grid source + publish a **constraint ownership matrix** (operational calendar / HARD unavailability / SOFT preferences / structural) covering `scheduling_settings`, `daily_breaks`, `instructor_availability`, `room_unavailability`, `constraint_types`, `college_constraint_settings`, `college_quality_settings` | `implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/A3-CONSTRAINT-OWNERSHIP-MATRIX-01.md` (new doc) | **AUTO_SAFE** (docs) |
| P2 | Repo-wide grep for `time_slots` and `room_availability` consumers (compensates for unavailable code search); record results | doc addendum to P1 | **AUTO_SAFE** |
| P3 | Source-only migration: `ALTER TABLE time_slot_templates ADD CONSTRAINT time_slot_templates_uq UNIQUE (college_id, study_system, day_of_week, start_time, end_time);` (+ dedupe pre-step) | `supabase/migrations/<ts>_time_slot_templates_uniqueness.sql` (source only) | **AUTO_SAFE** to author; **approval-gated** to apply |
| P4 | Deprecate legacy time-slots UI: banner "legacy — use قوالب أوقات المحاضرات", make read-only, remove from nav later | `src/routes/_authenticated/time-slots.tsx` | **AUTO_SAFE** |
| P5 | **Apply 20260720120000** to the database (closes UI↔RPC drift; activates atomic all-active-days HARD unavailability) | existing migration | **approval-gated** (DB write) |
| P6 | Remove room whitelist: disable `_ss_room_av` in engine assembly, then `DROP TABLE room_availability` after data audit; update any remaining references found in P2 | new source-only migration + engine assembly migration | **approval-gated** |
| P7 | Retire `time_slots`: data audit → archive → `DROP TABLE`; remove route | new source-only migration; `src/routes/_authenticated/time-slots.tsx` | **approval-gated** |
| P8 | Soft-preferences UI (A3.3): new "تفضيلات" tab writing `instructor_availability` rows with `is_preference=true` only; no engine change needed (`greedy.ts` already consumes; ensure validator treats them soft-only) | `src/routes/_authenticated/availability.tsx` or new route; `src/lib/availability/*` | **approval-gated** (product) |
| P9 | Document `break_between_sessions_min` as structural (not a named break) and lock severity of structural constraint seeds so they cannot be demoted to soft via UI | docs + optional guard migration | **AUTO_SAFE** docs; **approval-gated** guard |
| P10 | (Optional, later) Consolidate structural fields out of `scheduling_settings` into a dedicated structural settings home; keep working_days/day window as pure operational calendar | new migration + `scheduling-settings.tsx` split | **approval-gated** |

Ordering rationale: P1–P4 are safe docs/UI moves that freeze the target architecture; P5 un-breaks the live UI; P6–P7 remove the two remaining violations of A3.2/A3.1 after audits; P8 fills the A3.3 product gap; P9–P10 keep A3.4 clean.

---

## 6. Safety statement

- **No migration was applied. No database writes were performed.** This deliverable is a docs-only PR adding this single file.
- 20260720120000 remains **SOURCE ONLY — NOT APPLIED**, exactly as found.
- All schema/table claims above cite the migration file that creates the object; all engine/UI claims cite the source file read at `origin/main` (`7d738204`).

## 7. UNKNOWNs (unverifiable from source in this environment)

1. **Code search non-functional** (0 results for known-present terms like `instructor_availability`, `daily_breaks`): hidden consumers of `time_slots` / `room_availability` inside the large uninspected July migrations and `src/lib/conflict-engine/{validator,scorer}.ts` cannot be excluded — P2 grep is mandatory before P6/P7.
2. **Live DB state:** which migrations are actually applied and whether `time_slots` / `room_availability` / legacy `'available'` rows contain data — requires DB access; out of scope here.
3. **Prior swarm reports:** `implementation-reports/` contains prior availability work (`AVAILABILITY-ALL-ACTIVE-DAYS-BULK-ENTRY-01.md`); any other concurrent TRACK reports landing under `implementation-reports/USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01/` may refine P1–P10.
