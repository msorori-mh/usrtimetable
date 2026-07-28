# STAGE-03C — Live Blocker Reconciliation

Mission: `PLATFORM-LAUNCH-STAGE-03C-LIVE-BLOCKER-RECONCILIATION-01`
Generated: 2026-07-28 (Asia/Riyadh)
Scope: **read / analyze / document only**
Baseline: `docs/PLATFORM-LAUNCH/STAGE-03B-LIVE-PREVIEW-PREFLIGHT.md` (PR #102)
Production: `emzytxqkxjjhsivqxdiu` · ITCS `7168345f-cf9d-4789-b2ad-547abb687dc8`
Workbook: `C:\Users\Elite\Downloads\b002982d-763d-4aa7-a7f3-fed38fca4da9.xlsx`

**Hard bans honored:** no import confirm, no INSERT/UPDATE/DELETE, no DG/curriculum generation, no room-type writes, no migrations, no history repair, no Publish, no schedule create/run.

---

## FINAL_DECISION

`STAGE_03C_READY_FOR_ATOMIC_REMEDIATION`

Every non-READY preview outcome class has an evidence-backed classification. No unresolved reconciliation gap remains that would block planning the next atomic remediation wave. Apply itself is still forbidden until official sources / clarifications are signed.

---

## Method

1. Replayed Preview with the live Super Admin JWT against production catalog using the same parser/resolver as `/import` (`studySystemScope=both`, sheet→term map Sem1=`2026-T1`, Sem2=`Sem2`).
2. Extracted all non-MATCHED outcomes (265 expanded rows from 131 source rows).
3. Classified blockers by re-querying live `courses` / `plan_courses` / `plan_course_components` / `instructors` / `academic_cohorts` / headcounts — **no guessed links**.
4. Unique crosswalk links are recorded only as **evidence** when a single plan hit exists; they are **not** auto-apply instructions when level/term/program differ from the source row.

---

## Preview baseline (unchanged)

| Metric | Count |
|---|---:|
| Source rows | 131 |
| Expanded outcomes | 265 |
| READY / MATCHED | 0 |
| `course_not_found` | 186 |
| `ambiguous_component` | 36 |
| `delivery_groups` | 24 |
| `ambiguous_instructor` | 17 |
| `unknown_program` | 2 |

---

## 1) `course_not_found` (186) — classification

| Class | Count | Meaning |
|---|---:|---|
| `COURSE_CODE_MISMATCH` | **0** | No workbook value matched a catalog code-as-name pattern |
| `COURSE_NAME_ALIAS_REQUIRED` | **10** | Near-name / orthography candidates in same program×level×term; need official alias |
| `COURSE_NOT_IN_ACTIVE_PLAN` | **36** | Exact catalog name exists but not on an active plan hit for the row context |
| `WRONG_PROGRAM` | **2** | Exact name only under a different program |
| `WRONG_LEVEL` | **16** | Exact name in same program, different level |
| `WRONG_TERM` | **6** | Exact name in same program+level, different semester |
| `CATALOG_DATA_MISSING` | **116** | No exact/near plan or catalog evidence |
| `RESOLVER_BUG` | **0** | No case where same program×level×semester exact normalized name was present yet unmatched |

### Top repeated missing source titles (expanded outcomes)

| File course name | Outcomes |
|---|---:|
| التحليل والتصميم الكينوني | 8 |
| التنقيب في البيانات | 8 |
| نظم تشغيل | 8 |
| شبكات الحاسوب | 8 |
| مناهج البحث العلمي | 8 |
| البرمجة وحل المسائل | 6 |
| اساسيات ويب | 6 |
| امنية معلومات | 6 |
| بايثون | 6 |
| ذكاء اصطناعي | 6 |

### Evidence crosswalk (unique plan hit ≠ auto-remap)

24 expanded rows / **11 distinct** evidence links point to a unique plan course — but **all** are `WRONG_LEVEL`, `WRONG_TERM`, or `WRONG_PROGRAM`. Examples:

| File name | Source P/L | Evidence course | Evidence P/L/S | Class |
|---|---|---|---|---|
| اخلاقيات وتشريعات الامن السيبراني | CYB / 3 | CY355 أخلاقيات وتشريعات الأمن السيبراني | CYB / 3 / Sem1 | `WRONG_TERM` (file sheet Sem2) |
| التوجيه والتبديل | CYB / 2 | IT221 التوجيه والتبديل | CYB / 2 / Sem1 | `WRONG_TERM` |
| اساسيات نظم المعلومات | CIS / 2 | CIS111 أساسيات نظم المعلومات | CIS / 1 / Sem2 | `WRONG_LEVEL` |
| شبكات الحاسوب | CIS|CS / 3 | FR231 شبكات الحاسوب | same prog / 2 / Sem1 | `WRONG_LEVEL` |
| نظم استرجاع المعلومات | CIS / 4 | CIS321 نظم استرجاع المعلومات | CIS / 3 / Sem1 | `WRONG_LEVEL` |

**Rule:** do not rewrite source level/term/program from these links without an official academic decision. Apply-ready same-cell crosswalk count = **0**.

### Sample non-READY course rows (illustrative)

| Sheet | Row | Program | Level | System | File course | Blocker | Class |
|---|---:|---|---:|---|---|---|---|
| Sem2 | (various) | CYB | 3 | regular/parallel | اخلاقيات وتشريعات الامن السيبراني | `course_not_found` | `WRONG_TERM` |
| Sem1 | (various) | CIS | 3 | both | شبكات الحاسوب | `course_not_found` | `WRONG_LEVEL` |
| Sem1/2 | (many) | mixed | mixed | both | بايثون / ذكاء اصطناعي / روبوتكس | `course_not_found` | `CATALOG_DATA_MISSING` |

Full per-outcome extract was produced in-session (`stage03c-recon.json`, not committed).

---

## 2) `ambiguous_component` (36)

Course already matched; hours cannot select a single component / expand_all set.

| Class | Count |
|---|---:|
| `SOURCE_LABEL_AMBIGUOUS` | **0** |
| `PLAN_COMPONENT_DUPLICATE` | **30** |
| `HOURS_MISMATCH` | **6** |
| `RESOLVER_RULE_MISSING` | **0** |

### Pattern

- Dominant: multiple assignable components share the same `weekly_contact_hours` (typically theory=2 and practical=2) while file total hours = 2 → resolver cannot choose (`PLAN_COMPONENT_DUPLICATE`).
- Minority: file hours neither equal one component nor the sum of components (`HOURS_MISMATCH`).

Example (live): CIS L2 Sem2 «اساسيات قواعد البيانات» / FR221 — candidates theory 2h + practical 2h, both `required_room_type_id = null`.

### Metric mapping

- `COMPONENT_SOURCE_AMBIGUOUS` = 0
- `COMPONENT_DATA_ERRORS` = **36** (30 duplicate plan hours + 6 hours mismatch)

---

## 3) `ambiguous_instructor` (17 source rows)

Only **two distinct** workbook names; both are `DUPLICATE_NAME` (multiple employee records). No partial-name linking performed.

| Raw name | Rows | Candidates (employee_number) | Class |
|---|---:|---|---|
| د. عيسى محمد | many Sem2 | INST-030 (no AR name), EMP024 (عيسى محمد, assistant_professor), EMP015 (عيسى محمد, no dept) | `DUPLICATE_NAME` |
| د. مبارك السفياني | remaining | INST-035, EMP031 (assistant_professor + dept), EMP017 | `DUPLICATE_NAME` |

| Metric | Count |
|---|---:|
| `INSTRUCTOR_ALIAS_CONFIRMED` | **0** |
| `INSTRUCTOR_CLARIFICATION_REQUIRED` | **17** |
| `TITLE_VARIANT` | 0 |
| `EMPLOYEE_CODE_MISSING` | 0 |
| `INSTRUCTOR_RECORD_MISSING` | 0 |

Official HR must pick the canonical employee_number per person and deactivate/merge duplicates before import.

---

## 4) `unknown_program` (2)

| Sheet | Row | Original label | Course | Instructor | Class |
|---|---:|---|---|---|---|
| Sem2 | 67 | **علوم** | اساسيات الويب | د. محمد حسين عبدالعزيز شبيل | `OFFICIAL_CLARIFICATION_REQUIRED` |
| Sem1 | 77 | **الموازي** | برمجة موجهة | د. معاذ عبده محمد الصبري | `OFFICIAL_CLARIFICATION_REQUIRED` |

- `علوم` is incomplete (CS vs generic).
- `الموازي` is a study-system token, not a program — must not be aliased to a program code without official clarification.
- No new alias added.

| Metric | Count |
|---|---:|
| `PROGRAM_ALIAS_CONFIRMED` | **0** |
| `PROGRAM_CLARIFICATION_REQUIRED` | **2** |

---

## 5) `delivery_groups` (24)

Course + component already resolved; DG rows missing for the cohort×component.

### Dependencies (all 24)

| Missing dependency | Rows |
|---|---:|
| `approved_headcount` | 24 |
| `required_room_type_id` (null on target components) | 24 |
| `delivery_groups_not_generated` | 24 |

Example: CIS-L2-REG-2025-Sem2 · FR221 · theory+practical · HC not approved · room types null.

| Metric | Value |
|---|---:|
| `DELIVERY_GROUPS_READY_AFTER_DEPENDENCIES` | **0** |
| Eligible after HC + room-type only (still need generate call later) | 24 candidates |

DG generation remains a **later production write** after headcounts (official sources only) and room-type remediation.

---

## 6) Ordered remediation plan (atomic)

1. **Source fixes (workbook / policy)**
   - Clarify `علوم` and `الموازي`.
   - Fix WRONG_LEVEL / WRONG_TERM / WRONG_PROGRAM rows with academic owner sign-off (or correct source cells).
   - Fix file hours that cause `HOURS_MISMATCH` / choose theory vs practical when duplicate 2h+2h.
2. **Catalog data**
   - Add/rename missing courses (`CATALOG_DATA_MISSING` 116) or load official aliases (`COURSE_NAME_ALIAS_REQUIRED` 10).
   - Attach courses to active plans (`COURSE_NOT_IN_ACTIVE_PLAN` 36) at correct level/term.
   - Deduplicate instructor master data (عيسى محمد / مبارك السفياني).
3. **Room types**
   - Fill `required_room_type_id` for timetabled components (blocks DG for all 24 DG-ready course rows and broader readiness).
4. **Headcounts**
   - Official 2026–2027 sources only (Stage 03A: `HEADCOUNTS_READY_FOR_APPLY = 0` until authorized).
5. **Curriculum refresh (only if plan changed) → Delivery group generate**
   - After HC + room types; CYB already has groups; 48 cells still empty college-wide.
6. **Re-Preview** (expect READY > 0).
7. **Import confirm** — separate explicit approval; Legacy untouched; V2 insert_only.

---

## Metric board (requested)

| ID | Value |
|---|---:|
| COURSE_CODE_MISMATCH | 0 |
| COURSE_ALIAS_REQUIRED | 10 |
| COURSE_NOT_IN_PLAN | 36 |
| CATALOG_DATA_MISSING | 116 |
| RESOLVER_BUGS | 0 |
| COMPONENT_SOURCE_AMBIGUOUS | 0 |
| COMPONENT_DATA_ERRORS | 36 |
| INSTRUCTOR_ALIAS_CONFIRMED | 0 |
| INSTRUCTOR_CLARIFICATION_REQUIRED | 17 |
| PROGRAM_ALIAS_CONFIRMED | 0 |
| PROGRAM_CLARIFICATION_REQUIRED | 2 |
| DELIVERY_GROUPS_READY_AFTER_DEPENDENCIES | 0 |
| OFFICIAL_SOURCES_REQUIRED | yes — HC year policy; program labels; instructor employee picks; course aliases |
| PRODUCTION_WRITES_REQUIRED | later — catalog/plan, room types, HC approve, DG generate, then import |
| SOURCE_FIXES_REQUIRED | yes — level/term/program cells; hours; ambiguous labels |

Also classified but not in the short board: `WRONG_LEVEL=16`, `WRONG_TERM=6`, `WRONG_PROGRAM=2` (subset of the 186 `course_not_found`).

---

## Security / safety

- Files changed: this documentation only.
- Migrations / RLS / RPCs: no.
- Production writes: none.
- Sensitive data: analysis used live read session; no secrets committed.

---

## Related

- Stage 03B preflight: `STAGE-03B-LIVE-PREVIEW-PREFLIGHT.md`
- Stage 03A package / 03B runbook remain planning references for apply order.
