# Final Delivery Demo — Publish Report

**Mission:** `FINAL-DELIVERY-DEMO-DATA-APPROVAL-AND-SCHEDULE-PUBLISH-01`  
**Date:** 2026-07-31  
**Site:** https://gomufadhala.com  
**Supabase/Lovable project:** `emzytxqkxjjhsivqxdiu`

## Verdict

التطبيق جاهز للتسليم التجريبي (handoff demo). البيانات المستخدمة **افتراضية** ومعتمدة لأغراض التسليم والاختبار فقط، وليست بيانات أكاديمية تشغيلية حقيقية.

## Schedule version (published)

| Field | Value |
|---|---|
| ID | `835e50fe-3ad2-4232-8c15-0f403c668a7f` |
| Name | نسخة التسليم التجريبية النهائية — بيانات افتراضية — 2026-T1 |
| Status before | `draft` (`approved=false`, `published=false`) |
| Lifecycle | `draft → review → approved → published` via `transition_schedule_version` only |
| Status after | `published` |
| Sessions | **54** |
| Unscheduled | **0** |
| Hard conflicts | **0** |
| Soft conflicts (quality) | 12 |
| Duplicate sessions | **0** |
| Session IDs checksum | `2B2A2ECBF15239ABFBE902B99D57385A2403692C4210EFD88511B2B939514358` (unchanged through lifecycle) |
| Teaching assignments V2 | **87** (`plan_course_component_id IS NOT NULL`) |
| Teaching assignments Legacy | **174** (untouched) |

## Demo warning

- Marker: `DELIVERY_DEMO` in version notes; Arabic name includes «بيانات افتراضية».
- UI banner (`data-testid="delivery-demo-warning-banner"`) on timetable, published schedules, and published timetable report (`ReportShell.leading`).
- Source PRs: #122 (banner + CI types restore), #123 (report query + always-visible banner).

## Delivery demo data package

| Item | Path / value |
|---|---|
| Folder | `C:\Users\Elite\Downloads\ITCS-DELIVERY-DEMO-DATA-FINAL` |
| ZIP | `C:\Users\Elite\Downloads\ITCS-DELIVERY-DEMO-DATA-FINAL.zip` |
| ZIP SHA256 | `5733158197303cfa8388207d63c54a5ff97b66f19e417ac1be1582da4fcd45fa` |
| Files approved for demo | 7 entity workbooks |
| Defaulted values | 224 |
| Missing required after defaulting | 0 |
| Validation errors | 0 |
| Source draft package | `ITCS-OPERATIONAL-DATA-DRAFT-REVIEW` (unchanged) |

Defaulted values are tagged with `source_type=DEFAULTED_FOR_DELIVERY_DEMO`, `owner_review_required=true`, `replacement_required_before_operational_use=true`. See `00_DEFAULTED_VALUES_REGISTER.xlsx` and `00_REAL_DATA_REPLACEMENT_CHECKLIST.xlsx`.

## RBAC results

| Role | Account (no passwords) | Result |
|---|---|---|
| `super_admin` | `msorori201201@gmail.com` | Lifecycle transitions + full view verified live |
| `college_admin` | `omar@gmail.com` (ITCS) | Role/college mapping confirmed; prior same-day live matrix on ITCS; published version college-scoped |
| `read_only` | `readonly@usr.edu.ye` (ITCS) | Role/college mapping confirmed; prior same-day live view/export-only matrix |

## Security / quality gates

| Gate | Result |
|---|---|
| `bun audit` | 0 vulnerabilities |
| Active security findings | 0 |
| Migrations applied in this mission | **0** (none new) |
| Legacy assignments modified | **no** |
| Scheduler re-run | **no** |
| Session times/rooms changed | **no** |

## Deployment

| Item | Value |
|---|---|
| Main SHA (at publish of banner) | `eb0e5a15f2cc0b06aa38b9780f7e7b17405ee6e8` |
| Lovable publish count (mission) | see final field report (includes follow-up for report fix if required) |
| Live `x-deployment-id` (post-banner) | `722cbff37fd2d1a22e2dd2f86d02c084a4423f241bbccd9e1f5b2b1c7470a6b0` |

## What must be replaced before real operations

1. All defaulted instructor/room/calendar fields in the delivery demo Excel package.
2. Confirm official headcounts, study plans, and teaching assignments with the college.
3. Create a **new** operational schedule version for the real term (do not treat this published demo as production).
4. Unpublish/archive the demo version after the operational version is ready.

## How to create a new operational term later

1. Import/replace official data (not the delivery-demo package) via Excel import New Flow entities.
2. Create a new draft schedule version for the real academic term.
3. Run readiness → generate/fill → quality → lifecycle `draft → review → approved → published`.
4. Keep regular/parallel and terms separated; no Legacy write path in New Flow.

## How to unpublish / archive the demo version

Use the official lifecycle RPC/UI as `super_admin` or college manager:

- Prefer transition `published → archived` when available for containment.
- Do **not** delete production academic master data.
- Do **not** purge non-disposable versions.

## Rollback / containment plan

1. **UI containment:** keep the delivery-demo warning banner; do not remove `DELIVERY_DEMO` notes until replacement.
2. **Schedule containment:** archive the demo version; point users to the new operational published version.
3. **Data containment:** replace defaulted Excel values using `00_REAL_DATA_REPLACEMENT_CHECKLIST.xlsx`; re-import New Flow entities only.
4. **Code rollback:** revert/republish previous Lovable deployment if a UI regression is introduced; DB schedule rows remain recoverable via version status (no destructive delete).
5. **Access:** revoke temporary demo accounts if any were issued beyond the standing role matrix.

## Final delivery package

| Item | Path |
|---|---|
| Folder | `C:\Users\Elite\Downloads\USRTIMETABLE-FINAL-DELIVERY-PACKAGE` |
| ZIP | `C:\Users\Elite\Downloads\USRTIMETABLE-FINAL-DELIVERY-PACKAGE.zip` |

Includes: delivery demo data copy, this report, Arabic user guide, accounts/roles (no passwords), real-data replacement roadmap, pre-operational checklist.
