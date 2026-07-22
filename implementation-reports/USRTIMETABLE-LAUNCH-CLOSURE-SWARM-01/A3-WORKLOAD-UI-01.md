# A3.5 — Faculty Workload Policies UI + Import Gap Fixes (source-only)

- Swarm: USRTIMETABLE-LAUNCH-CLOSURE-SWARM-01 / WAVE-04 (agent AGENT-WORKLOAD-IMPORTS-A3)
- Base: `feat/a3-workload-policies` (stacked on A3 source-only migration branch)
- Validation: **static review only** (no runtime gates in this environment; no DB writes, no migration apply, no deploy)

---

## 1. Scope

1. Policy-management UI for `faculty_workload_policies` (النصاب حسب الدرجة الأكاديمية) — gap **G2** from `A3-WORKLOAD-AND-IMPORTS-01.md` §1.4/§2.4.
2. AUTO_SAFE import gap fix: inbound formula-injection sanitation — gap **G1** (§2.4: "add an inbound cell sanitizer in the import parse path, mirror the export-side escape; add harness check").
3. Static harness + registry entry + this report.

House pattern followed literally: **PR #62** (headcount UI over source-only RPCs) — route + `src/lib/<domain>/{api,types,rules}.ts` + nav entry + `routeTree.gen.ts` registration + documented readiness blocker. No direct DML.

## 2. Files

| File | Change |
|---|---|
| `src/routes/_authenticated/workload-policies.tsx` | New route. Policy list (read-only RLS SELECT), upsert/deactivate via A3 RPCs, term + study-system scoped form, assigned/remaining/overload table, warnings panel, per-instructor resolved-policy viewer. |
| `src/lib/faculty-workload/types.ts` | Hand-maintained mirror of the A3 RPC contract (house style, same as `scheduling-headcount/types.ts`). |
| `src/lib/faculty-workload/api.ts` | RPC wrappers only: `upsert_faculty_workload_policy`, `deactivate_faculty_workload_policy`, `resolve_faculty_workload_policy`, `list_faculty_workload_assigned_hours`, `list_faculty_workload_overload_warnings`. No `.from(` at all. |
| `src/lib/faculty-workload/rules.ts` | Client-side validation mirroring RPC checks + Arabic labels. |
| `src/components/app-layout.tsx` | Nav entry "النصاب التدريسي" in group "موارد التدريس" (roles: ALL — view for everyone, manage actions hidden for read_only). |
| `src/routeTree.gen.ts` | Route registered (mirrors the generator's insertion points, as in PR #62). |
| `src/lib/excel-import/formula-escape.ts` | G1: added `looksLikeInboundFormula` + `sanitizeImportCellValue` (inbound side). Export-side escape untouched. |
| `src/lib/excel-import/templates.ts` | G1: `parseExcel` now sanitizes every inbound text cell and returns an additive `sanitizedCells` count. |
| `tests/harness/faculty-workload-ui.harness.ts` | New static harness. |
| `tests/harness/run.mjs` | Registered `faculty-workload-ui.harness.ts` immediately after `faculty-workload-policies.harness.ts` (alphabetical relative to neighbors). |

## 3. Behavior

- **Permissions**: enforcement stays in RPC/RLS (`can_view_college` / `can_manage_college`). The UI only reflects it: manage actions gated by `useCanManageActiveCollege`; college_admin sees own college via active college; super_admin switches colleges; read_only sees lists/tables with no action buttons.
- **assigned / remaining / overload**: `list_faculty_workload_assigned_hours` drives the table (المسند / المطلوب / المتبقي = required − assigned / الحالة). `list_faculty_workload_overload_warnings` drives the advisory panel. Overload is a **warning, never a block** — stated in the page and matching PHASE-9.4 doctrine.
- **Readiness blocker (runtime drift, documented)**: all five RPCs are SOURCE ONLY — NOT APPLIED (gate `APPROVE_DB_MIGRATION_APPLY`). The page carries an explicit amber banner; RPC failures surface a "طبقة RPCs غير مطبقة بعد" note instead of silent breakage. Runtime operation is blocked until the migration is approved and applied.
- **G1 sanitizer semantics**: leading `=` or `@` always neutralized with a `'` prefix (mirror of the export-side escape); leading `+`/`-` neutralized only when **not** followed by a digit or `.`, so phone numbers (`+966…`) and negative numbers pass through untouched. Headers are not touched (unknown/duplicate headers are already blocked by validators).

## 4. Decisions & deviations

1. **`src/integrations/supabase/types.ts` NOT hand-extended** (deviation from PR #62, deliberate): (a) the file is auto-generated — current main/branch copies (identical sha `94858be0…`) were regenerated and no longer contain PR #62's hand-added headcount entries, proving hand edits there do not survive; (b) the file (~114 KB) exceeds the available remote-write tool limit; (c) the UI compiles without it: RPC calls use the `supabase.rpc(name as never, args as never)` house pattern, and the policy list uses `.select("*")` on the existing table entry with an explicit cast. Regenerating types after apply remains a local-gates step.
2. **Policy list read via RLS SELECT** (not a list RPC): A3 keeps SELECT granted; only writes are revoked. No new RPC invented.
3. **Edit locks the grain** (rank_code / study_system / term disabled while editing) because the grain identifies the row; changing it = a new policy (matches the RPC's upsert-on-grain semantics).
4. **G1 count is additive** (`sanitizedCells` extra return field): existing callers destructure `{ headers, rows }` and are unaffected. Surfacing the count in the import wizard UI is left as a follow-up (recorded as residual risk, not silently dropped).

## 5. Import gap dispositions (from A3-WORKLOAD-AND-IMPORTS-01 §2.3/§2.4)

| Gap | Disposition |
|---|---|
| G1 inbound formula sanitation | **FIXED (AUTO_SAFE)** — this change. Verified `parseExcel` had no inbound sanitation before the fix. |
| G2 workload-policies UI | **FIXED (AUTO_SAFE)** — this change (UI layer; runtime blocked until apply). |
| G3 `section_groups` (المجموعات المشتركة للمحاضرات) classification | **UNKNOWN** — needs lead/product decision (binding says SYSTEM_GENERATED; repo evidence is LEGACY_ONLY retained template, no generator). Not touched. |
| G4 `course_offering_sections` as distinct entity | **UNKNOWN** — doc-only question; no evidence it ever existed as a separate entity. Not touched. |
| G5 stale harness path (`teaching-assignments-v2-runtime`) | Out of A3.5 scope (remediation plan assigns it to a separate wave). Not touched. |
| G6 SOURCE ONLY / NOT APPLIED foundations | No action — apply requires `APPROVE_DB_MIGRATION_APPLY`. |

No other ACTIVE-import template/validator gaps were found that are both clearly source-fixable and decision-free.

## 6. Safety

- No DB writes, no migration apply, no deploy, no seeds, no backfill.
- No Legacy references (`sections`, `section_id`, `section_number`, `course_offering_sections`, `section_groups`) in any new file — harness-enforced.
- No regular/parallel mixing: study system is a scoping filter/dimension, never a merge.
- Official terminology used: الدفعات الدراسية (untouched), الإسناد التدريسي, مجموعات المحاضرات والمعامل (untouched), أعداد الدفعات المعتمدة للجدولة (untouched).

## 7. Validation

**Static review only — runtime gates pending CI.**
- `tests/harness/faculty-workload-ui.harness.ts`: file presence, RPC-only writes (no direct DML), RPC↔migration contract cross-check, role reflection, readiness-blocker banner, advisory-overload doctrine, no Legacy references, terminology, nav/route-tree/registry wiring, G1 sanitizer wiring (inbound added, export preserved).
- Not run here (no local toolchain in this environment): `tsc`, harness suite, dev server. Residual risk: `parseExcel`'s new return field and the routeTree hand-edit are unverified by a real build; first CI run must confirm.

## 8. UNKNOWNs / BLOCKERs

- **BLOCKER (readiness)**: A3 migration + all dependencies are SOURCE ONLY / NOT APPLIED; every write and both list RPCs fail at runtime until approval + apply. Documented in-page and here.
- **UNKNOWN**: G3, G4 (above).
- **UNKNOWN**: whether `import.tsx` (or any other caller) relies on `parseExcel`'s exact two-field return shape in a way TS structural typing would not catch (static read shows `{ headers, rows }` destructuring only — compatible — but unverified by build).
- **UNKNOWN**: `src/integrations/supabase/types.ts` on main currently lacks PR #62's headcount entries while `scheduling-headcounts.tsx` queries those tables; whether CI typecheck tolerates this is outside A3.5 scope.
