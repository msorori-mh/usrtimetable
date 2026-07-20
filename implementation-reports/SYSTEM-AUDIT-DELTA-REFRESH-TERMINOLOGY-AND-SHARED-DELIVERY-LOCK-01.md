# SYSTEM-AUDIT-DELTA-REFRESH-TERMINOLOGY-AND-SHARED-DELIVERY-LOCK-01

**Phase:** `SYSTEM-AUDIT-DELTA-COMPLETION-01`
**Decision:** `PASS_WITH_FINDINGS — TARGET_TERMINOLOGY_AND_SHARED_DELIVERY_MODEL_COMPLETE`
**Baseline merged:** `1af8787e676f6040b824dc3e177b3aacbcfdaec2`
**Scope:** documentation and implementation reports only

## Official terminology

| Contract | Required target UI label |
| --- | --- |
| `academic_cohort` | الدفعة الدراسية |
| `cohort_elective_selections` | المقررات الاختيارية المعتمدة |
| `scheduling_settings` / working days / time slots | أيام وفترات الدوام |
| `delivery_groups` | مجموعات المحاضرات والمعامل |
| `teaching_assignments` | الإسناد التدريسي |

## Catalog sharing versus shared delivery

Catalog sharing associates a course with several programs or departments. It does not combine cohort delivery.

The separate target capability is **«المجموعات المشتركة للمحاضرات»**: an optional group for one course component
that links multiple independently generated cohort courses. Cohorts and their curricula remain academically
independent. The group has one or more teaching assignments and produces one authoritative session that appears for
every participating cohort and once in the instructor and room timetables.

Capacity, conflicts, hours, college, study system, and authorization must be checked. `regular` and `parallel` are
not combined by default. Theory can be shared while labs remain separate. No implementation exists; runtime remains
fail-closed. This report does not select a final table name or migration.

## Target navigation

- البنية الأكاديمية: الدفعات الدراسية؛ المقررات الاختيارية المعتمدة.
- التدريس: مقررات الدفعات؛ المجموعات المشتركة للمحاضرات؛ مجموعات المحاضرات والمعامل؛ الإسناد التدريسي؛ النصاب التدريسي.
- الموارد: أيام وفترات الدوام.

## Target workflow

الخطة الدراسية → الدفعة الدراسية → المقررات الاختيارية المعتمدة → توليد مقررات الدفعة → تحديد الحاجة إلى
مجموعة مشتركة للمحاضرات (اختياري) → توليد مجموعات المحاضرات والمعامل → الإسناد التدريسي → إعداد أيام وفترات
الدوام → تسجيل عدم التوفر والتفضيلات → بناء الجدول → المراجعة والاعتماد والنشر.

## Phase A launch packages

1. **A1 — النموذج الأكاديمي وعزل Legacy:** تثبيت الخطة/الدفعة/الاختيارات، وعزل sections ومساراتها القديمة.
2. **A2 — المجموعات المشتركة للمحاضرات:** تصميم وتنفيذ واعتماد النموذج المستقل، الصلاحيات، التدقيق، السعة،
   العزل، التعارضات، الإسقاط، ومنع العد المزدوج، مع fail-closed قبل اكتماله.
3. **A3 — الوقت وعدم التوفر والنصاب والاستيراد:** توحيد أيام وفترات الدوام، فصل hard/soft، إتاحة سياسات النصاب،
   وحصر الاستيراد في المسارات الذرية المعتمدة.
4. **A4 — الاعتماد والصلاحيات والإثبات:** دورة حياة الجدول، صلاحيات الانتقال، أدلة الاختبار، إثبات runtime،
   وبوابات النشر دون تنفيذ إنتاجي في هذه المرحلة.

## Safety and verification

- Product source changes: **None**
- Migration source changes: **None**
- DB writes: **None**
- Migration apply: **None**
- Deploy/Publish: **None**
- PR posture: remains Draft pending user review and merge approval
