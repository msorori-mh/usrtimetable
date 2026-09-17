# مصفوفة عقود قوالب الاستيراد النهائية

**Contract version:** 1.0.0
**Source:** `src/lib/excel-import/templates.ts` + validators + RPC dispatch
**قاعدة:** أسماء الأعمدة الإنجليزية (`key`) ثابتة؛ العناوين العربية للعرض فقط.

## قيم مرجعية رسمية (Pilot)

| المجال | القيم |
|--------|--------|
| study_system (Pilot) | `regular`, `parallel` |
| study_system (Schema cohorts) | `regular`, `parallel`, `evening`, `distance`, `other` |
| component_type (قابل للإسناد) | `theory`, `practical`, `tutorial`, `project` |
| component_type (Schema + ممنوع للإسناد) | `summer_training` |
| boolean | `true` / `false` (ويُقبل أيضًا 1/0/نعم/لا في الـ validator) |
| days (daily_breaks) | `0..6` مفصولة بفواصل (0=الأحد) |
| room_type | `lecture_hall`, `computer_lab`, `network_lab`, `cybersecurity_lab`, `electronics_lab`, `workshop`, `seminar_room` |
| count_status | `estimated`, `confirmed`, `locked` |
| term_type | `first`, `second` |
| employment_type | `full_time`, `part_time`, `visiting` |

# ACTIVE_NEW_FLOW

## academic_terms

- **Label:** الفصول الأكاديمية
- **Sheet:** terms
- **Natural key:** رمز الفصل (`code`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| code | الرمز | required | text | — | trim | — | missing_required / unknown_* | yes | 2025-F |  |
| name | الاسم | required | text | — | trim | — | missing_required / unknown_* | no | الفصل الأكاديمي الأول 2025 |  |
| academic_year | السنة_الأكاديمية | optional | text | — | trim | — | invalid_enum / type | no | 2025-2026 |  |
| term_type | الفصل_الدراسي | optional | text | first, second | trim | academic_terms.code | invalid_enum / type | no | first |  |
| start_date | تاريخ_البداية | optional | text | — | trim | — | invalid_enum / type | no | 2025-09-01 |  |
| end_date | تاريخ_النهاية | optional | text | — | trim | — | invalid_enum / type | no | 2026-01-15 |  |
| teaching_weeks_count | عدد_أسابيع_التدريس | optional | number | — | Number | — | invalid_enum / type | no | 15 |  |
| is_active | نشط | optional | boolean | — | toBool | — | invalid_enum / type | no | false |  |

## instructors

- **Label:** المحاضرون
- **Sheet:** instructors
- **Natural key:** رقم الموظف (`employee_number`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| employee_number | رقم_الموظف | required | text | — | trim | instructors.employee_number | missing_required / unknown_* | yes | EMP001 |  |
| full_name | الاسم_الكامل | required | text | — | trim | — | missing_required / unknown_* | no | أحمد محمد |  |
| full_name_ar | الاسم_بالعربي | optional | text | — | trim | — | invalid_enum / type | no | أحمد محمد |  |
| full_name_en | الاسم_بالانجليزي | optional | text | — | trim | — | invalid_enum / type | no | Ahmed Mohamed |  |
| email | البريد_الالكتروني | optional | text | — | trim | — | invalid_enum / type | no | a@x.com |  |
| phone | الهاتف | optional | text | — | trim | — | invalid_enum / type | no | 0555555555 |  |
| specialization | التخصص | optional | text | — | trim | — | invalid_enum / type | no | أمن المعلومات |  |
| academic_degree | الدرجة_العلمية | optional | text | — | trim | — | invalid_enum / type | no | دكتوراه |  |
| academic_rank | الرتبة_الأكاديمية | optional | text | — | trim | — | invalid_enum / type | no | أستاذ مساعد |  |
| instructor_type_code | نوع_المحاضر_رمز | optional | text | — | trim | — | invalid_enum / type | no | PERM |  |
| department_code | رمز_القسم | optional | text | — | trim | departments.code | invalid_enum / type | no | CS |  |
| employment_type | نوع_التوظيف | optional | text | full_time, part_time, visiting | trim | — | invalid_enum / type | no | full_time |  |
| max_weekly_hours | أقصى_ساعات_أسبوعية | optional | number | — | Number | — | invalid_enum / type | no | 18 |  |
| max_hours_per_day | أقصى_ساعات_يومية | optional | number | — | Number | — | invalid_enum / type | no | 6 |  |
| administrative_release_hours | ساعات_إعفاء_إداري | optional | number | — | Number | — | invalid_enum / type | no | 0 |  |
| admin_tasks | المهام_الإدارية | optional | text | — | trim | — | invalid_enum / type | no |  |  |
| external_source | الجهة_الخارجية | optional | text | — | trim | — | invalid_enum / type | no |  |  |
| notes | ملاحظات | optional | text | — | trim | — | invalid_enum / type | no |  |  |
| is_active | نشط | optional | boolean | — | toBool | — | invalid_enum / type | no | true |  |

## rooms

- **Label:** القاعات والمعامل
- **Sheet:** rooms
- **Natural key:** رمز القاعة (`code`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| code | رمز_القاعة | required | text | — | trim | — | missing_required / unknown_* | yes | R-101 |  |
| name | اسم_القاعة | required | text | — | trim | — | missing_required / unknown_* | no | قاعة 101 |  |
| capacity | السعة | required | number | — | Number | — | missing_required / unknown_* | no | 30 |  |
| room_type | نوع_القاعة | required | text | lecture_hall, computer_lab, network_lab, cybersecurity_lab, electronics_lab, workshop, seminar_room | trim | rooms.room_type enum | missing_required / unknown_* | no | lecture_hall |  |
| room_type_code | نوع_القاعة_رمز | optional | text | — | trim | — | invalid_enum / type | no |  | legacy alias only |
| building_code | رمز_المبنى | optional | text | — | trim | — | invalid_enum / type | no | A |  |
| floor | الطابق | optional | text | — | trim | — | invalid_enum / type | no | 1 |  |
| building | المبنى_نص | optional | text | — | trim | — | invalid_enum / type | no |  |  |
| available_start_time | متاح_من | optional | time | — | HH:MM | — | invalid_enum / type | no | 08:00 |  |
| available_end_time | متاح_إلى | optional | time | — | HH:MM | — | invalid_enum / type | no | 14:00 |  |
| notes | ملاحظات | optional | text | — | trim | — | invalid_enum / type | no |  |  |
| is_active | نشط | optional | boolean | — | toBool | — | invalid_enum / type | no | true |  |

## daily_breaks

- **Label:** الاستراحات اليومية
- **Sheet:** daily_breaks
- **Natural key:** الاسم (`name`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| name | الاسم | required | text | — | trim | — | missing_required / unknown_* | yes | استراحة الظهر |  |
| start_time | من_الساعة | required | time | — | HH:MM | — | missing_required / unknown_* | no | 12:00 |  |
| end_time | إلى_الساعة | required | time | — | HH:MM | — | missing_required / unknown_* | no | 12:30 |  |
| days | الأيام | required | days_csv | — | trim | — | missing_required / unknown_* | no | 0,1,2,3,4 |  |
| affects_scheduling | يؤثر_على_الجدولة | optional | boolean | — | toBool | — | invalid_enum / type | no | true |  |

## full_study_plan

- **Label:** خطة دراسية كاملة (كل المستويات)
- **Sheet:** full_plan
- **Natural key:** خطة + رمز مقرر (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| program_code | رمز_البرنامج | required | text | — | trim | academic_programs.code | missing_required / unknown_* | composite | CS |  |
| plan_code | رمز_الخطة | required | text | — | trim | study_plans.code | missing_required / unknown_* | composite | CS-2024 |  |
| plan_name | اسم_الخطة | optional | text | — | trim | — | invalid_enum / type | composite | خطة علوم الحاسب 2024 |  |
| plan_version | نسخة_الخطة | optional | text | — | trim | — | invalid_enum / type | composite | 1 |  |
| effective_year | سنة_السريان | optional | number | — | Number | — | invalid_enum / type | composite | 2024 |  |
| level_number | رقم_المستوى | required | number | — | Number | — | missing_required / unknown_* | composite | 1 |  |
| semester | الفصل | required | number | — | Number | — | missing_required / unknown_* | composite | 1 |  |
| department_code | رمز_القسم | required | text | — | trim | departments.code | missing_required / unknown_* | composite | CS |  |
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | CS101 |  |
| course_name | اسم_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | مقدمة في الحاسب |  |
| credit_hours | الساعات_المعتمدة | required | number | — | Number | — | missing_required / unknown_* | composite | 3 |  |
| theory_hours | ساعات_نظري | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| practical_hours | ساعات_عملي | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| tutorial_hours | ساعات_تمرين | optional | number | — | Number | — | invalid_enum / type | composite | 0 |  |
| project_hours | ساعات_مشروع | optional | number | — | Number | — | invalid_enum / type | composite | 0 |  |
| is_elective_slot | خانة_اختيارية | optional | boolean | — | toBool | elective_slots.slot_code | invalid_enum / type | composite | false |  |
| elective_slot_code | رمز_الخانة_الاختيارية | optional | text | — | trim | elective_slots.slot_code | invalid_enum / type | composite | CY3XX(E) |  |
| is_summer_training | تدريب_صيفي | optional | boolean | — | toBool | — | invalid_enum / type | composite | false |  |
| is_graduation_project | مشروع_تخرج | optional | boolean | — | toBool | — | invalid_enum / type | composite | false |  |
| course_nature | طبيعة_المقرر | optional | text | department, college, university | trim | courses.code | invalid_enum / type | composite | department |  |
| is_shared | مشترك | optional | boolean | — | toBool | — | invalid_enum / type | composite | false |  |
| is_required | إجباري | optional | boolean | — | toBool | — | invalid_enum / type | composite | true |  |
| lectures_per_week | عدد_المحاضرات_أسبوعياً | optional | number | — | Number | — | invalid_enum / type | composite | 1 |  |
| lecture_session_duration | مدة_المحاضرة | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| labs_per_week | عدد_المعامل_أسبوعياً | optional | number | — | Number | — | invalid_enum / type | composite | 1 |  |
| lab_session_duration | مدة_المعمل | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| required_room_type_for_lecture | نوع_قاعة_المحاضرة | optional | text | — | trim | — | invalid_enum / type | composite | lecture_hall |  |
| required_room_type_for_lab | نوع_قاعة_المعمل | optional | text | — | trim | — | invalid_enum / type | composite | computer_lab |  |

## study_plan_courses

- **Label:** خطة دراسية (مستوى/فصل)
- **Sheet:** plan_courses
- **Natural key:** خطة + رمز مقرر (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| program_code | رمز_البرنامج | required | text | — | trim | academic_programs.code | missing_required / unknown_* | composite | CS |  |
| plan_code | رمز_الخطة | required | text | — | trim | study_plans.code | missing_required / unknown_* | composite | CS-2024 |  |
| plan_name | اسم_الخطة | optional | text | — | trim | — | invalid_enum / type | composite | خطة علوم الحاسب 2024 |  |
| plan_version | نسخة_الخطة | optional | text | — | trim | — | invalid_enum / type | composite | 1 |  |
| effective_year | سنة_السريان | optional | number | — | Number | — | invalid_enum / type | composite | 2024 |  |
| level_number | رقم_المستوى | required | number | — | Number | — | missing_required / unknown_* | composite | 1 |  |
| semester | الفصل | required | number | — | Number | — | missing_required / unknown_* | composite | 1 |  |
| department_code | رمز_القسم | required | text | — | trim | departments.code | missing_required / unknown_* | composite | CS |  |
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | CS101 |  |
| course_name | اسم_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | مقدمة في الحاسب |  |
| credit_hours | الساعات_المعتمدة | required | number | — | Number | — | missing_required / unknown_* | composite | 3 |  |
| theory_hours | ساعات_نظري | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| practical_hours | ساعات_عملي | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| tutorial_hours | ساعات_تمرين | optional | number | — | Number | — | invalid_enum / type | composite | 0 |  |
| project_hours | ساعات_مشروع | optional | number | — | Number | — | invalid_enum / type | composite | 0 |  |
| is_elective_slot | خانة_اختيارية | optional | boolean | — | toBool | elective_slots.slot_code | invalid_enum / type | composite | false |  |
| elective_slot_code | رمز_الخانة_الاختيارية | optional | text | — | trim | elective_slots.slot_code | invalid_enum / type | composite |  |  |
| is_summer_training | تدريب_صيفي | optional | boolean | — | toBool | — | invalid_enum / type | composite | false |  |
| is_graduation_project | مشروع_تخرج | optional | boolean | — | toBool | — | invalid_enum / type | composite | false |  |
| course_nature | طبيعة_المقرر | optional | text | department, faculty, university | trim | courses.code | invalid_enum / type | composite | department |  |
| is_shared | مشترك | optional | boolean | — | toBool | — | invalid_enum / type | composite | false |  |
| is_required | إجباري | optional | boolean | — | toBool | — | invalid_enum / type | composite | true |  |
| lectures_per_week | عدد_المحاضرات_أسبوعياً | optional | number | — | Number | — | invalid_enum / type | composite | 1 |  |
| lecture_session_duration | مدة_المحاضرة | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| labs_per_week | عدد_المعامل_أسبوعياً | optional | number | — | Number | — | invalid_enum / type | composite | 1 |  |
| lab_session_duration | مدة_المعمل | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| required_room_type_for_lecture | نوع_قاعة_المحاضرة | optional | text | — | trim | — | invalid_enum / type | composite | lecture_hall |  |
| required_room_type_for_lab | نوع_قاعة_المعمل | optional | text | — | trim | — | invalid_enum / type | composite | computer_lab |  |

## course_programs

- **Label:** ربط المقررات بالبرامج (مقررات مشتركة)
- **Sheet:** course_programs
- **Natural key:** مقرر + برنامج (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | UNI100 |  |
| program_code | رمز_البرنامج | required | text | — | trim | academic_programs.code | missing_required / unknown_* | composite | CS |  |

## academic_cohorts

- **Label:** الدفعات الأكاديمية (V2)
- **Sheet:** academic_cohorts
- **Natural key:** برنامج + مستوى + نظام + سنة دخول + فصل (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| program_code | رمز_البرنامج | required | text | — | trim | academic_programs.code | missing_required / unknown_* | composite | CS |  |
| level_number | رقم_المستوى | required | number | — | Number | — | missing_required / unknown_* | composite | 3 |  |
| study_system | نظام_الدراسة | required | text | regular, parallel | trim | — | missing_required / unknown_* | composite | regular |  |
| entry_year | سنة_الدخول | required | number | — | Number | — | missing_required / unknown_* | composite | 2024 |  |
| term_code | رمز_الفصل | required | text | — | trim | academic_terms.code | missing_required / unknown_* | composite | 2026-F |  |
| expected_students | الطلاب_المتوقعون | optional | number | — | Number | — | invalid_enum / type | composite | 60 |  |
| count_status | حالة_العد | optional | text | estimated, confirmed, locked | trim | — | invalid_enum / type | composite | estimated |  |
| code | رمز_الدفعة | optional | text | — | trim | — | invalid_enum / type | composite | CS-L3-2024 |  |
| active | نشط | optional | boolean | — | toBool | — | invalid_enum / type | composite | true |  |

## elective_slot_courses

- **Label:** مقررات الخانات الاختيارية (V2)
- **Sheet:** elective_slot_courses
- **Natural key:** خطة + خانة + مقرر (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| program_code | رمز_البرنامج | required | text | — | trim | academic_programs.code | missing_required / unknown_* | composite | CS |  |
| plan_code | رمز_الخطة | required | text | — | trim | study_plans.code | missing_required / unknown_* | composite | CS-2024 |  |
| plan_version | نسخة_الخطة | optional | text | — | trim | — | invalid_enum / type | composite | 1 |  |
| elective_slot_code | رمز_الخانة_الاختيارية | required | text | — | trim | elective_slots.slot_code | missing_required / unknown_* | composite | CY3XX(E) |  |
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | CY301 |  |

## cohort_elective_selections

- **Label:** اختيارات الدفعات الاختيارية (V2)
- **Sheet:** cohort_elective_selections
- **Natural key:** دفعة + خانة (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| cohort_code | رمز_الدفعة | required | text | — | trim | academic_cohorts.code | missing_required / unknown_* | composite | CS-L3-2024 |  |
| elective_slot_code | رمز_الخانة_الاختيارية | required | text | — | trim | elective_slots.slot_code | missing_required / unknown_* | composite | CY3XX(E) |  |
| selected_course_code | رمز_المقرر_المختار | required | text | — | trim | courses.code | missing_required / unknown_* | composite | CY301 |  |

## teaching_assignments_v2

- **Label:** الإسناد التدريسي V2 (دفعة + مجموعة تدريس)
- **Sheet:** assignments_v2
- **Natural key:** دفعة + مقرر + محاضرة + مجموعة + محاضر (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| cohort_code | رمز_الدفعة | required | text | — | trim | academic_cohorts.code | missing_required / unknown_* | composite | CS-L3-2024 |  |
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | CS101 |  |
| component_type | نوع_المحاضرة | required | text | theory, practical, tutorial, project | trim | — | missing_required / unknown_* | composite | theory | summer_training forbidden at validate+RPC |
| delivery_group_code | رمز_مجموعة_التقديم | required | text | — | trim | delivery_groups.group_code | missing_required / unknown_* | composite | G1 |  |
| employee_number | رقم_الموظف_للمحاضر | required | text | — | trim | instructors.employee_number | missing_required / unknown_* | composite | EMP001 |  |
| assigned_component_hours | ساعات_المحاضرة_المسندة | optional | number | — | Number | — | invalid_enum / type | composite | 3 |  |
| study_system | نظام_الدراسة | optional | text | regular, parallel | trim | — | invalid_enum / type | composite | regular |  |
| is_active | نشط | optional | boolean | — | toBool | — | invalid_enum / type | composite | true |  |
| expected_students | الطلاب_المتوقعون | optional | number | — | Number | — | invalid_enum / type | composite | 30 |  |
| required_room_type | نوع_القاعة_المطلوب | optional | text | lecture_hall, computer_lab, network_lab, cybersecurity_lab, electronics_lab, workshop, seminar_room | trim | rooms.room_type enum | invalid_enum / type | composite |  |  |
| notes | ملاحظات | optional | text | — | trim | — | invalid_enum / type | composite |  |  |

# LEGACY_ONLY (مخفي من واجهة التشغيل الجديد)

## sections

- **Label:** المجموعات الدراسية
- **Sheet:** sections
- **Natural key:** فصل + مقرر + رقم المجموعة + نظام الدراسة (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| term_code | رمز_الفصل | required | text | — | trim | academic_terms.code | missing_required / unknown_* | composite | 2025-F |  |
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | CS101 |  |
| section_number | رقم_المجموعة | required | text | — | trim | — | missing_required / unknown_* | composite | 1 |  |
| capacity | السعة_القصوى | optional | number | — | Number | — | invalid_enum / type | composite | 30 |  |
| study_system | نظام_الدراسة | optional | text | regular, parallel, both | trim | — | invalid_enum / type | composite | regular |  |

## course_offerings

- **Label:** إسناد المقررات
- **Sheet:** offerings
- **Natural key:** فصل + برنامج + مقرر (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| term_code | رمز_الفصل | required | text | — | trim | academic_terms.code | missing_required / unknown_* | composite | 2025-F |  |
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | CS101 |  |
| program_code | رمز_البرنامج | optional | text | — | trim | academic_programs.code | invalid_enum / type | composite | CS |  |
| level_number | رقم_المستوى | optional | number | — | Number | — | invalid_enum / type | composite | 1 |  |
| plan_code | رمز_الخطة | optional | text | — | trim | study_plans.code | invalid_enum / type | composite | CS-2024 |  |
| expected_students | الطلاب_المتوقعون | optional | number | — | Number | — | invalid_enum / type | composite | 60 |  |
| sections_count | عدد_المجموعات | optional | number | — | Number | — | invalid_enum / type | composite | 2 |  |
| status | الحالة | optional | text | draft, approved, scheduled, cancelled | trim | — | invalid_enum / type | composite | draft |  |
| is_active | نشط | optional | boolean | — | toBool | — | invalid_enum / type | composite | true |  |
| notes | ملاحظات | optional | text | — | trim | — | invalid_enum / type | composite |  |  |

## teaching_assignments

- **Label:** الإسناد التدريسي
- **Sheet:** assignments
- **Natural key:** محاضر + طرح + نوع محاضرة (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| term_code | رمز_الفصل | required | text | — | trim | academic_terms.code | missing_required / unknown_* | composite | 2025-F |  |
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | CS101 |  |
| employee_number | رقم_الموظف_للمحاضر | required | text | — | trim | instructors.employee_number | missing_required / unknown_* | composite | EMP001 |  |
| section_number | رقم_المجموعة | optional | text | — | trim | — | invalid_enum / type | composite | 1 |  |
| session_type | نوع_المحاضرة | required | text | lecture, lab, tutorial, seminar, workshop | trim | — | missing_required / unknown_* | composite | lecture |  |
| weekly_hours | ساعات_أسبوعية | optional | number | — | Number | — | invalid_enum / type | composite | 3 |  |
| expected_students | الطلاب_المتوقعون | optional | number | — | Number | — | invalid_enum / type | composite | 30 |  |
| required_room_type | نوع_القاعة_المطلوب | optional | text | lecture_hall, computer_lab, network_lab, cybersecurity_lab, electronics_lab, workshop, seminar_room | trim | rooms.room_type enum | invalid_enum / type | composite |  |  |
| notes | ملاحظات | optional | text | — | trim | — | invalid_enum / type | composite |  |  |

## section_groups

- **Label:** المجموعات المدمجة
- **Sheet:** section_groups
- **Natural key:** فصل + مقرر + اسم المجموعة (`_logical`)
- **Commit:** commit_import_job_atomic

| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| term_code | رمز_الفصل | required | text | — | trim | academic_terms.code | missing_required / unknown_* | composite | 2025-F |  |
| course_code | رمز_المقرر | required | text | — | trim | courses.code | missing_required / unknown_* | composite | UNI100 |  |
| group_name | اسم_المجموعة | required | text | — | trim | — | missing_required / unknown_* | composite | مجموعة A |  |
| member_section_numbers | أرقام_المجموعات | required | csv | — | trim | — | missing_required / unknown_* | composite | 1,2,3 |  |
| notes | ملاحظات | optional | text | — | trim | — | invalid_enum / type | composite |  |  |

## departments

- **Label:** الأقسام الأكاديمية
- **Classification:** IMPORT_OR_UI
- **Commit:** commit_import_job_atomic
- **Scope:** الكلية المحددة فقط

| column_name | Arabic label | required/optional | data type |
|---|---|---|---|
| code | الرمز | required | text |
| name | الاسم | required | text |
| head_name | رئيس القسم | optional | text |
| is_active | نشط | optional | boolean |
| order_index | الترتيب | optional | number |

## academic_programs

- **Label:** البرامج الأكاديمية
- **Classification:** IMPORT_OR_UI
- **Commit:** commit_import_job_atomic
- **Dependency:** قسم مطابق داخل الكلية المحددة

| column_name | Arabic label | required/optional | data type |
|---|---|---|---|
| code | الرمز | required | text |
| name | الاسم | required | text |
| department | القسم | required | text |
| degree_type | نوع الدرجة | optional | enum |
| duration_years | المدة بالسنوات | optional | number |
| is_active | نشط | optional | boolean |
| admission_status | القبول مفتوح | optional | boolean |
| description | الوصف | optional | text |

> الحقول غير الموجودة في مخطط قاعدة البيانات الحالي تُقبل في القالب ولا تُحفظ حتى تُضاف رسميًا للمخطط.

## Generated / UI-managed (لا قوالب تشغيلية جديدة)

| entity | classification | notes |
|---|---|---|
| delivery_groups | GENERATED_NOT_IMPORTED | generate_cohort_delivery_groups |
| cohort_curriculum | GENERATED_NOT_IMPORTED | generate_cohort_curriculum |
| schedule_versions / schedule_sessions | GENERATED_NOT_IMPORTED | schedule builder |
| instructor_availability | UI_MANAGED_NOT_IMPORTED | /availability |
| time_slot_templates | UI_MANAGED_NOT_IMPORTED | UI time templates |
| faculty_workload_policies | UI_MANAGED_NOT_IMPORTED | no ImportEntity |
| colleges | UI_MANAGED_NOT_IMPORTED | foundation UI |
