# Admin Routes and Capabilities Inventory

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`
**Sources:** `src/components/app-layout.tsx`, `src/routes/_authenticated/**`, `src/lib/excel-import/registry.ts`, page contracts (not labels alone)

## Summary counts

| Metric | Count |
| --- | ---: |
| Sidebar nav items | 38 |
| Authenticated route modules | 56 (+ layout) |
| Report child routes | 12 |
| Hidden (no sidebar) routes | 2 (`/course-offerings`, `/timetable/$versionId`) |
| Public routes | 2 (`/`, `/auth`) |

**Roles:** `super_admin` · `college_admin` · `read_only`
**Write UX gate:** `useCanManageActiveCollege()` (super_admin or college_admin for active college). Real enforcement: RLS + RPCs.

---

## Current sidebar structure

| Group | Items |
| --- | --- |
| *(ungrouped)* | لوحة التحكم، جاهزية البيانات، تنظيف البيانات |
| إدارة النظام | الجامعة، الكلّيات، المستخدمون |
| كلّيتي | كلّيتي |
| البنية الأكاديمية | الأقسام، البرامج، الخطط، المقررات، الفصول، المجموعات الدراسية، الدفعات، مجموعات التدريس |
| موارد التدريس | المحاضرون، القاعات، فترات يدوية، التوفّر/عدم التوفّر، الإسناد |
| التهيئة الأكاديمية | أنواع محاضرين/قاعات، مباني، أنواع محاضرات، إعدادات جدولة، تقويم، استراحات، قوالب أوقات، قيود، مقررات مشتركة، قوالب استيراد |
| الجدولة | بناء الجدول، نسخ الجدول، المنشورة، تلقائية، تعارضات، جودة |
| التقارير | التقارير |
| استيراد البيانات | قوالب البيانات، استيراد Excel، سجل الاستيراد |

---

## Full inventory

Legend — **Decision:** KEEP · MERGE · RENAME · MOVE · HIDE · LEGACY_ONLY · REMOVE_AFTER_MIGRATION · REDESIGN

### A. Ops / ungrouped

| Arabic | Route | File | Roles | Scope | Purpose | Ops | Tables/RPCs | Works? | Data? | Dup? | Flow | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| لوحة التحكم | `/dashboard` | `dashboard.tsx` | ALL | college | Overview | read | colleges, readiness signals | Yes | varies | No | Current | KEEP |
| جاهزية البيانات | `/data-readiness` | `data-readiness.tsx` | ALL | college | Pre-schedule readiness | read | readiness queries | Yes | checklist | Overlaps reports/data-readiness | Current | MERGE (with reports readiness later) |
| تنظيف البيانات | `/data-cleanup` | `data-cleanup.tsx` | admin nav | college | Bulk cleanup tabs | CRUD bulk | courses, instructors, rooms, assignments | Yes | ops | Overlaps import/cleanup | Current | MOVE → بيانات |

### B. System admin

| Arabic | Route | File | Roles | Scope | Purpose | Ops | Tables/RPCs | Works? | Dup? | Flow | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| الجامعة | `/universities` | `universities.tsx` | super_admin (redirect) | global | University CRUD | CRUD | universities | Yes | No | Current | KEEP |
| الكلّيات | `/colleges` | `colleges.tsx` | super_admin (redirect) | global | College CRUD | CRUD | colleges | Yes | Catalog download only | Current | KEEP |
| المستخدمون | `/users` | `users.tsx` | super_admin | global | Users/roles/memberships | CRUD | profiles, user_roles, user_colleges | Yes | No | Current | KEEP |
| كلّيتي | `/my-college` | `my-college.tsx` | college_admin, read_only | college | College profile view | read/limited | colleges | Yes | Partial overlap colleges | Current | KEEP |

### C. Academic structure

| Arabic | Route | File | Roles | Scope | Purpose | Ops | Tables/RPCs | Works? | Dup? | Flow | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| الأقسام | `/departments` | `departments.tsx` | ALL; write canManage | college + study_system | Org units | CRUD Dialog | departments | Yes | Catalog UI-only template | Current | KEEP |
| البرامج | `/programs` | `programs.tsx` | ALL; write canManage | college; **department required in UI+DB** | Academic programs | CRUD Dialog | academic_programs | Yes | Catalog UI-only | Current | KEEP |
| الخطط الدراسية | `/study-plans` | `study-plans.tsx` | ALL; write canManage | college/program | Plan shell + courses UI | CRUD | study_plans, plan_courses | Yes | Overlaps full_study_plan import | Current | KEEP + clarify import path |
| المقررات | `/courses` | `courses.tsx` | ALL; write canManage | college/dept | Course catalog | CRUD | courses | Yes | Hours also on plan_courses | Current | KEEP |
| الفصول الأكاديمية | `/terms` | `terms.tsx` | ALL; write canManage | college | Terms (year as column) | CRUD | academic_terms | Yes | Import also | Current | KEEP |
| المجموعات الدراسية | `/sections` | `sections.tsx` | ALL; write canManage | college | **Legacy sections** mislabeled as study groups | CRUD | sections | Yes (Legacy) | Conflicts with cohorts/DG naming | **Legacy** | **LEGACY_ONLY → HIDE** |
| الدفعات الأكاديمية | `/academic-cohorts` | `academic-cohorts.tsx` | ALL; write canManage | college + study_system | Cohort SoT + generate curriculum/DG | CRUD + generate RPCs | academic_cohorts, generate_cohort_curriculum, generate_cohort_delivery_groups | Yes | Core New Flow | **New Flow** | KEEP (expand as hub) |
| مجموعات التدريس | `/delivery-groups` | `delivery-groups.tsx` | ALL | college | Read-only DG list | read | delivery_groups | Yes (diagnostic) | Also embedded in cohorts | **Generated** | MERGE into teaching hub; keep diagnostic |
| مقررات الفصل | `/course-offerings` | `course-offerings.tsx` | Auth; **not in nav** | college | Read-only Legacy/diagnostic offerings | read | course_offerings | Yes read-only | Generated by curriculum | Dual | HIDE / LEGACY_ONLY diagnostic |

### D. Teaching resources

| Arabic | Route | File | Roles | Scope | Purpose | Ops | Tables/RPCs | Works? | Dup? | Flow | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| المحاضرون | `/instructors` | `instructors.tsx` | ALL; write canManage | college | Instructor master | CRUD | instructors | Yes | Import also | Current | KEEP |
| القاعات والمعامل | `/rooms` | `rooms.tsx` | ALL; write canManage | college | Rooms | CRUD | rooms | Yes | Import also | Current | KEEP |
| فترات الجدول اليدوية | `/time-slots` | `time-slots.tsx` | ALL; write canManage | college | Manual time_slots CRUD | CRUD | time_slots | Yes | Overlaps templates | Ambiguous | **REDESIGN / MERGE** with templates |
| التوفّر/عدم التوفّر | `/availability` | `availability.tsx` | ALL; write canManage | college | Instructor avail + room avail/unavail; Hard/Soft flag | Tabs CRUD | instructor_availability, room_availability, room_unavailability | Yes | Soft/Hard mixed UI | Current | REDESIGN (split Hard/Soft labels) |
| الإسناد التدريسي | `/teaching-assignments` | `teaching-assignments.tsx` | ALL; write canManage | college | TA V2 workspace | Assign/deactivate Dialogs | teaching_assignments V2 RPCs | Yes | Import TA V2 | **New Flow** | KEEP |

### E. Lookups / settings

| Arabic | Route | File | Roles | Purpose | Decision |
| --- | --- | --- | --- | --- | --- |
| أنواع المحاضرين | `/instructor-types` | `instructor-types.tsx` | ALL | Lookup CRUD | KEEP (move under موارد) |
| أنواع القاعات | `/room-types` | `room-types.tsx` | ALL | Lookup CRUD | KEEP |
| المباني | `/buildings` | `buildings.tsx` | ALL | Lookup CRUD | KEEP |
| أنواع المحاضرات | `/session-types` | `session-types.tsx` | ALL | Lookup CRUD | KEEP / evaluate need |
| إعدادات الجدولة | `/scheduling-settings` | `scheduling-settings.tsx` | ALL | Operating calendar hours/days | KEEP → قواعد/تقويم |
| التقويم الأكاديمي | `/academic-calendar` | `academic-calendar.tsx` | ALL | Calendar entries | MERGE conceptually with operating calendar |
| الاستراحات اليومية | `/daily-breaks` | `daily-breaks.tsx` | ALL | Breaks affecting scheduling | KEEP |
| قوالب أوقات المحاضرات | `/time-slot-templates` | `time-slot-templates.tsx` | ALL | **Authoritative grid for conflicts/auto/builder** | KEEP (SoT for time) |
| إعدادات القيود | `/constraint-settings` | `constraint-settings.tsx` | ALL | Structural constraint weights | KEEP |
| المقررات المشتركة | `/shared-courses` | `shared-courses.tsx` | ALL | course_programs links | KEEP → بنية أكاديمية |
| قوالب الاستيراد | `/import-templates` | `import-templates.tsx` | ALL | DB-managed import_templates table | **MERGE/HIDE** vs `/data-templates` |

### F. Scheduling

| Arabic | Route | File | Roles | Purpose | Tables/RPCs | Flow | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- |
| بناء الجدول | `/schedule-builder` | `schedule-builder.tsx` | ALL; edit canManage+state | Primary V2 builder | schedule_sessions, assignment RPCs | New Flow | KEEP |
| جدول نسخة | `/timetable/$versionId` | `timetable.$versionId.tsx` | Auth; hidden | Older grid editor | schedule_sessions | Legacy UI | LEGACY_ONLY → HIDE |
| نسخ الجدول | `/schedule-versions` | `schedule-versions.tsx` | ALL | Version lifecycle | schedule_versions, transition RPC | Current | KEEP |
| الجداول المنشورة | `/published-schedules` | `published-schedules.tsx` | ALL | Published list | schedule_versions status | Current | KEEP |
| الجدولة التلقائية | `/auto-schedule` | `auto-schedule.tsx` | admin | Greedy auto fill | auto_schedule_runs | Current | KEEP (clarify vs builder) |
| فحص التعارضات | `/conflict-checks` | `conflict-checks.tsx` | ALL | Run conflict engine | conflict_checks/results | Current | KEEP |
| جودة الجدول | `/schedule-quality` | `schedule-quality.tsx` | ALL | Quality runs | schedule_quality_runs | Current | KEEP |

### G. Import / data

| Arabic | Route | File | Roles | Purpose | Decision |
| --- | --- | --- | --- | --- | --- |
| قوالب البيانات | `/data-templates` | `data-templates.tsx` | ALL | Download catalog (New/Legacy badges) | KEEP (simplify catalog) |
| استيراد Excel | `/import` | `import.tsx` | admin; hard block !canManage | ACTIVE_NEW_FLOW only | KEEP |
| سجل الاستيراد | `/import-history` | `import-history.tsx` | ALL | import_jobs/errors | KEEP |

### H. Reports hub

| Arabic | Route | File | Section | Flow | Decision |
| --- | --- | --- | --- | --- | --- |
| التقارير | `/reports` | `reports.tsx` + index | hub | — | KEEP |
| جدول المحاضر | `/reports/instructor-schedule` | … | Timetable | New | KEEP |
| جدول المجموعة | `/reports/section-timetable` | … | Timetable | **Name Legacy** | RENAME → دفعة/مجموعة تدريس |
| جدول القاعة | `/reports/room-timetable` | … | Timetable | New | KEEP |
| جدول البرنامج/المستوى | `/reports/program-level-timetable` | … | Timetable | New | KEEP |
| أعباء المحاضرين | `/reports/instructor-workload` | … | Analytics | New | KEEP |
| استخدام القاعات | `/reports/room-utilization` | … | Analytics | New | KEEP |
| تعارضات | `/reports/conflicts` | … | Operational | New | KEEP |
| جاهزية | `/reports/data-readiness` | … | Operational | Dup page | MERGE |
| غير مجدولة | `/reports/unscheduled` | … | Operational | New | KEEP |
| ملخص الجودة | `/reports/quality-summary` | … | Operational | New | KEEP |
| المنشور | `/reports/published-timetable` | … | Official | New | KEEP |
| جدول الأقسام | `/reports/department-schedule` | … | **Legacy** | Legacy | LEGACY_ONLY → HIDE |

---

## Dialogs / tabs / primary actions (patterns)

| Surface | UI pattern | Primary actions |
| --- | --- | --- |
| Most CRUD pages | Create/Edit Dialog + delete | Create, Edit, Delete |
| LookupPage family | Shared dialog shell | Create, Edit, Delete |
| availability | 3 tabs | Hard/Soft on instructor rows |
| data-cleanup | 4 entity tabs + BulkDialog | Bulk delete/clean |
| academic-cohorts | Cards + AlertDialog | Generate curriculum, Generate delivery groups |
| teaching-assignments | Dialog + AlertDialog | Assign, Deactivate |
| schedule-builder | Sheets + unsaved dialog | Place/move/edit sessions from assignments |
| schedule-versions | Create/Clone dialogs | Create, Clone, transition lifecycle |
| auto-schedule | Confirm AlertDialog | Run |

---

## Missing admin surfaces (no dedicated page)

| Capability | Evidence | Impact |
| --- | --- | --- |
| `faculty_workload_policies` CRUD | Table + registry note “UI managed”; **zero route references** | Workload policies cannot be administered in UI |
| Cohort elective selections dedicated UX | Import entity exists; limited in-page UX | Elective approval path unclear |
| Explicit approve/publish wizard | Lifecycle RPCs exist; UX fragmented across versions/builder/quality | Approval journey incomplete |
| Audit log viewer | `audit_logs` table; no nav item | Ops visibility gap |

---

## Initial navigation health verdict

- **Operational New Flow** is present but **buried** among Legacy and lookup noise.
- **Naming collision:** «المجموعات الدراسية» (sections) vs «مجموعات التدريس» (delivery_groups) vs «الدفعات».
- **Dual time sources** and **dual template centers** create false choices.
- **Many URL-reachable pages lack page-level role denial** (sidebar-only hide).
