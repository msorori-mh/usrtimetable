# ترتيب الاستيراد والاعتماديات (Pilot / New Flow)

**Contract version:** 1.0.0  
**Source of truth:** `src/lib/excel-import/registry.ts` → `OFFICIAL_IMPORT_ORDER`

## النموذج الأكاديمي الملزم

```
study plan
→ academic cohort
→ cohort curriculum (مولَّد)
→ approved cohort electives
→ plan course components
→ delivery groups (مولَّدة)
→ teaching assignments v2
→ schedule builder
```

## الترتيب الرسمي

| الخطوة | البند | النوع | الاعتماديات |
|--------|--------|--------|-------------|
| 1 | الكليات / الأقسام / البرامج | واجهة | جامعة |
| 2 | `academic_terms` | استيراد ذري | كلية |
| 3 | `full_study_plan` (أو `study_plan_courses`) | استيراد ذري | برامج، أقسام |
| 4 | `course_programs` | استيراد ذري | مقررات، برامج |
| 5 | `instructors` | استيراد ذري | أقسام (اختياري) |
| 6 | `rooms` | استيراد ذري | مبانٍ (اختياري) |
| 7 | `daily_breaks` | استيراد ذري | — |
| 8 | سياسات النصاب / التوفر / قوالب الفترات | واجهة | محاضرون، قاعات |
| 9 | `academic_cohorts` | استيراد ذري | برامج، مستويات، فصول |
| 10 | `elective_slot_courses` | استيراد ذري | خطة، خانات، مقررات |
| 11 | `cohort_elective_selections` | استيراد ذري | دفعات، elective_slot_courses |
| 12 | توليد منهج الدفعة (cohort curriculum) | RPC مولَّد | دفعات، خطة، اختيارات |
| 13 | توليد مجموعات التقديم (delivery groups) | RPC مولَّد | منهج الدفعة |
| 14 | `teaching_assignments_v2` | استيراد ذري | دفعات، delivery_groups، محاضرون |
| 15 | محرر الجدول | نظام | إسناد V2، قاعات، فترات |

## مستبعد من الاستيراد التشغيلي

| الكيان | التصنيف | السبب |
|--------|----------|--------|
| `sections` / `section_groups` | LEGACY_ONLY | الشعب ليست سياق المسار الجديد |
| `course_offerings` (تشغيل) | GENERATED / LEGACY | مولَّدة من منهج الدفعة |
| `delivery_groups` | GENERATED_NOT_IMPORTED | `generate_cohort_delivery_groups` |
| `schedule_versions` / `schedule_sessions` | GENERATED_NOT_IMPORTED | محرر الجدول |
| تسجيل طلاب فردي للمقررات الإلزامية | DEPRECATED / غير موجود | الخطة المعتمدة تحدد مقررات الدفعة |

## قواعد الاسم

```
<entity>_<study_system>_<context>.xlsx   # للكيانات المرتبطة بنظام الدراسة
<entity>_college-<code>.xlsx             # للمرجعيات العامة
```

الاسم للتوثيق فقط — التحقق يعتمد على أعمدة الملف.
