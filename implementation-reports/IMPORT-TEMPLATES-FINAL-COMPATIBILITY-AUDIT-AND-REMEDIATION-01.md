# IMPORT-TEMPLATES-FINAL-COMPATIBILITY-AUDIT-AND-REMEDIATION-01

## Decision

**PASS_WITH_NOTES — IMPORT_TEMPLATES_FINAL_AUDIT_COMPLETE**

## Baseline

| Item | Value |
|------|--------|
| Branch | `codex/import-templates-final-audit` |
| HEAD / origin/main | `c91861999d47371a590973c4bf7a9adf8804f779` |
| Worktree | clean at start |
| Supabase project (reference only) | `emzytxqkxjjhsivqxdiu` |

## Inventory count

| Surface | Count |
|---------|------:|
| `ImportEntity` / TEMPLATES | 15 |
| ACTIVE_NEW_FLOW (UI + Pilot) | 11 |
| LEGACY_ONLY (hidden from new UI) | 4 |
| GENERATED_NOT_IMPORTED (documented) | delivery_groups, cohort_curriculum, schedule_* |
| Data Templates catalog entries | 27+ (classified) |
| Checked-in `.xlsx` | 0 (generated at runtime) |

## Active templates (Pilot)

1. academic_terms  
2. instructors  
3. rooms  
4. daily_breaks  
5. full_study_plan  
6. study_plan_courses  
7. course_programs  
8. academic_cohorts  
9. elective_slot_courses  
10. cohort_elective_selections  
11. teaching_assignments_v2  

## Legacy templates (retained, hidden)

- sections  
- course_offerings  
- teaching_assignments (V1)  
- section_groups  

## Deprecated / excluded operational templates

- student course registrations (not present)  
- existing_schedule_sessions (GENERATED_NOT_IMPORTED)  
- any V2 template requiring section_number (removed from active set)

## Generated-not-imported

- delivery_groups (`generate_cohort_delivery_groups`)  
- cohort curriculum (`generate_cohort_curriculum`)  
- course_offerings in new flow (from curriculum)  
- schedule_versions / schedule_sessions / published schedules  

## Mismatches found and fixed

| Issue | Fix |
|-------|-----|
| Catalog `full_study_plan` used English headers incompatible with TEMPLATES | Aligned Arabic headers + sheet `full_plan` to TEMPLATES |
| TA V2 template listed `summer_training` in enums while RPC forbids it | Enums → theory/practical/tutorial/project only |
| Cohort/V2 `study_system` included evening/distance/other in Pilot dropdowns | Pilot enums → regular \| parallel |
| `room_type` not marked required though validator rejects blank | `required: true` |
| No unknown/duplicate header rejection | Blocking `unknown_column` / `duplicate_header` |
| No capacity ≤ 0 rejection | `invalid_capacity` |
| No official classification / filename / import order | `registry.ts` + UI wiring |
| Catalog IMPORT_ORDER still promoted Legacy offerings/sections/TA V1 | Replaced with Pilot order + V2 entities |
| Template workbooks lacked version metadata | Metadata sheet + contract_version / generated_at / entity_key |
| No formula-injection escaping on export examples | `formula-escape.ts` |
| Legacy still discoverable without warning in data-templates | Badges + download warnings; generated blocked |

## Final contracts

- Doc: `docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md`  
- Registry: `src/lib/excel-import/registry.ts` (`IMPORT_CONTRACT_VERSION = 1.0.0`)

## Final import order

See `docs/IMPORT-ORDER-AND-DEPENDENCIES.md`.

## Generated sample files

Directory: `C:\projects\usrtimetable-final-import-templates`  
External catalog: `C:\projects\FINAL-IMPORT-TEMPLATES-CATALOG.md`  
Generator: `scripts/generate-final-import-templates.ts`  
Samples are synthetic; **not** committed to Git.

## Round-trip results

Harness `import-templates-final-audit.harness.ts`: **PASS**  
Verified per active entity: generate → sheet names → exact headers → instructions → Metadata → parse.

## UI results

- `/import` uses `listImportUiEntities()` only (11 active).  
- Legacy sections/offerings/TA V1/section_groups hidden.  
- Dependency notes + official order summary shown.  
- Filename convention via `suggestedTemplateFilename`.  
- `read_only` / non-managers blocked by `useCanManageActiveCollege`.  
- `/data-templates` shows classification badges; Legacy warned; generated download blocked.

## Security results

- Preview: `requireImportManager` + college scope.  
- Commit: `commit_import_job_atomic` job_id only; stored payload authoritative.  
- No client operational DML in commit/validate.  
- Formula injection escape for exported cell values starting with `= + - @`.

## Quality gates

| Gate | Result |
|------|--------|
| import-templates-final-audit harness | PASS |
| import-pipeline-safety / atomic / preapply | PASS |
| room-import-normalize | PASS |
| academic-delivery-v2-import-generator | PASS (updated for registry UI) |
| TypeScript (`tsc --noEmit`) | PASS |
| Build (`npm run build`) | PASS |
| Scoped ESLint (changed import surfaces) | PASS |
| `git diff --check` | PASS (CRLF autocrlf warnings only; no conflict markers) |

## Explicit non-actions

- **DB writes:** none  
- **Import execution / commit_import_job_atomic on prod:** none  
- **Migration apply / Supabase CLI push/reset:** none  
- **Deploy / Publish:** none  
- **Legacy table deletion:** none  

## Remaining blockers / notes

1. `instructor_availability`, `time_slot_templates`, `faculty_workload_policies` remain **UI-managed** (no atomic ImportEntity) — intentional for Pilot.  
2. Colleges/departments/programs: UI foundation, not atomic Excel commit.  
3. Schema still allows cohort `evening|distance|other`; Pilot templates restrict to `regular|parallel`.  
4. Catalog download for Legacy remains available with warnings (parsers retained).  
5. SheetJS data-validation dropdowns are best-effort (community build).
