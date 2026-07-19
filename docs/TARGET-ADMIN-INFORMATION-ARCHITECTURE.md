# Target Admin Information Architecture

**Phase:** SYSTEM-WIDE-DOMAIN-AND-ADMIN-ARCHITECTURE-AUDIT-01
**Baseline:** `c6b0d861f006d4202349bfa77ed24a5508e2b727`
**Hypothesis tested against:** actual nav in `app-layout.tsx` + route contracts + mandatory academic model

## Current menu (as shipped)

1. Ungrouped: لوحة التحكم · جاهزية البيانات · تنظيف البيانات
2. إدارة النظام: الجامعة · الكلّيات · المستخدمون
3. كلّيتي: كلّيتي
4. البنية الأكاديمية: أقسام · برامج · خطط · مقررات · فصول · **مجموعات دراسية (Legacy)** · دفعات · مجموعات تدريس
5. موارد التدريس: محاضرون · قاعات · **فترات يدوية** · توفّر · إسناد
6. التهيئة الأكاديمية: look-ups كثيرة · إعدادات · تقويم · استراحات · قوالب أوقات · قيود · مشتركة · **قوالب استيراد**
7. الجدولة: بناء · نسخ · منشور · تلقائي · تعارضات · جودة
8. التقارير
9. استيراد البيانات: قوالب بيانات · استيراد · سجل

**Problems validated:** Legacy in primary academic nav; dual time grids; dual template centers; readiness duplicated; teaching chain split across academic + resources; no workload policies; Soft/Hard mixed.

---

## Target menu (proposed)

Role filters unchanged in spirit: super_admin global; college_admin/read_only college-scoped; write gated by canManage.

### 1. التأسيس المؤسسي
| Item | Route (reuse) | Notes |
| --- | --- | --- |
| الجامعة | `/universities` | super_admin |
| الكلّيات | `/colleges` | super_admin |
| الأقسام | `/departments` | |
| البرامج | `/programs` | department required |
| كلّيتي | `/my-college` | college roles |

### 2. البنية الأكاديمية
| Item | Route | Notes |
| --- | --- | --- |
| السنوات والفصول | `/terms` | year as field |
| المقررات | `/courses` | catalog |
| الخطط الدراسية | `/study-plans` | + components |
| الدفعات | `/academic-cohorts` | hub: electives, generate curriculum/DG |
| الاختيارات المعتمدة | *new or cohort tab* | elective selections |
| المقررات المشتركة | `/shared-courses` | moved from تهيئة |

### 3. الموارد
| Item | Route | Notes |
| --- | --- | --- |
| المحاضرون | `/instructors` | + types as sub |
| القاعات والمعامل | `/rooms` | + types/buildings sub |
| تقويم التشغيل | `/scheduling-settings` + `/daily-breaks` + `/academic-calendar` | grouped |
| قوالب أوقات المحاضرات | `/time-slot-templates` | **sole grid SoT** |

### 4. التدريس
| Item | Route | Notes |
| --- | --- | --- |
| مقررات الدفعات | diagnostic offerings / cohort summary | generated |
| مجموعات التدريس | cohort hub + optional `/delivery-groups` | generated |
| التكليفات التدريسية | `/teaching-assignments` | V2 |
| النصاب | *new* workload policies + report link | **gap today** |

### 5. قواعد الجدولة
| Item | Route | Notes |
| --- | --- | --- |
| عدم توفر المحاضرين | `/availability` Hard instructor | split UX |
| عدم توفر القاعات | `/availability` Hard rooms | |
| تفضيلات الجدولة | Soft prefs | split UX |
| القيود الهيكلية | `/constraint-settings` | |

### 6. الجداول
| Item | Route | Notes |
| --- | --- | --- |
| إصدارات الجداول | `/schedule-versions` | |
| محرر الجدول | `/schedule-builder` | primary |
| الجدولة التلقائية | `/auto-schedule` | assist |
| التعارضات | `/conflict-checks` | |
| المراجعة والجودة | `/schedule-quality` | |
| الاعتماد والنشر | versions transitions + `/published-schedules` | clarify CTA |
| الجداول المنشورة | `/published-schedules` | |

### 7. البيانات
| Item | Route | Notes |
| --- | --- | --- |
| الاستيراد الجماعي | `/import` | |
| قوالب البيانات | `/data-templates` | simplified |
| جاهزية البيانات | `/data-readiness` (merge report) | |
| تنظيف البيانات | `/data-cleanup` | |
| سجل الاستيراد | `/import-history` | |

### 8. التقارير
Keep hub; rename section timetable; hide department legacy; add cohort report emphasis; link workload.

### 9. إدارة النظام
| Item | Route | Notes |
| --- | --- | --- |
| المستخدمون والصلاحيات | `/users` | |
| سجل التدقيق | *new viewer* | gap |
| الإعدادات العامة | constrained | super_admin only for global |

Dashboard remains home.

---

## Mapping: current → target

| Current | Target action | Reason |
| --- | --- | --- |
| `/sections` المجموعات الدراسية | **HIDE** (Legacy) | Violates no-sections model; naming trap |
| `/time-slots` | **HIDE** / deprecate | Templates are SoT |
| `/import-templates` | **HIDE** or admin-advanced | Duplicate authority vs catalog |
| `/timetable/$versionId` | **HIDE** | Superseded by builder |
| `/course-offerings` | Keep hidden diagnostic | Generated |
| `/delivery-groups` | MOVE under تدريس | Not “academic structure” master data |
| `/teaching-assignments` | MOVE under تدريس | Align chain |
| `/availability` | SPLIT labels under قواعد | Hard vs Soft |
| `/data-readiness` + report | **MERGE** | One readiness |
| `/reports/department-schedule` | **HIDE** | Legacy |
| `/reports/section-timetable` | **RENAME** | Cohort/DG language |
| Lookups (types, buildings, session-types) | Nested under الموارد | Reduce top-level noise |
| جاهزية/تنظيف ungrouped | MOVE → البيانات | Ops cohesion |
| قوالب الاستيراد + قوالب البيانات | Single templates entry | DUP-H01 |

## Elements that disappear from primary nav

- المجموعات الدراسية (sections)
- فترات الجدول اليدوية
- قوالب الاستيراد (DB) as peer of قوالب البيانات
- جدول الأقسام (Legacy report)
- Legacy timetable deep link (not in nav today — keep out)

## Elements that merge

- Readiness page + readiness report
- Operating calendar screens (settings + breaks + calendar) under one group
- DG college list into teaching/cohort hub
- Template centers into one data hub

## Decision principle

> Every top-level item must answer: *Is this master data, generated truth, a rule, a schedule action, or a report?*
> If two items answer the same question, one must merge or hide.
