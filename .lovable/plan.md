# مسار اعتماد رسمي لاستثناء تعارض المحاضر بين الكليات

## الهد
حاليًا يرفض النظام أي محاضرة يتقاطع وقتها مع جدول محاضر في كلية أخرى (حالة د. الجحدبي مع جدول الآداب السبت)، ولا توجد أي طريقة نظامية لاعتماد استثناء. الخطة تضيف مسارًا رسميًا: طلب استثناء → اعتماد → تسجيل صاحب القرار والسبب والنطاق → عرضه في شاشة التعارضات وتقارير الاستثناءات. جدول الآداب المنشور لا يُقرأ إلا للعرض ولا يُعدّل إطلاقًا.

## ما سيراه المستخدم
- في صفحة «فحص التعارضات» قسم جديد: «استثناءات تعارض المحاضر بين الكليات».
  - بطاقة لكل استثناء: اسم المحاضر، الكلية الأخرى وجدولها المرجعي، اليوم والوقت، السبب، من اعتمده ومتى، وحالته (معتمد / ملغى).
  - زر «طلب استثناء» لمدير الكلية: يختار المحاضر واليوم والفترة ويكتب سببًا إلزاميًا.
  - زر «اعتماد» و«إلغاء الاعتماد» يظهر لمشرف النظام فقط، ويطلب سببًا عند الإلغاء.
- بعد الاعتماد يسمح النظام بجدولة المحاضرة داخل النطاق المعتمد فقط، ويظهر التعارض في التقارير بوصفه «استثناء معتمد» لا مانع نشر.

## التنفيذ التقني

### قاعدة البيانات (ترحيل واحد)
1. جدول جديد `public.cross_college_instructor_waivers`:
   `id, college_id (الكلية الطالبة), schedule_version_id, instructor_id, external_college_id, day_of_week, start_time, end_time, reason, scope_note, status ('pending'|'approved'|'revoked'), requested_by, requested_at, approved_by, approved_at, revoked_by, revoked_at, revoke_reason, conflict_exception_id, created_at, updated_at` + مؤجل `updated_at` trigger.
   GRANT: `SELECT, INSERT` لـ`authenticated`، `ALL` لـ`service_role`. RLS: القراءة لمن يستطيع عرض الكلية الطالبة أو الكلية الأخرى؛ لا UPDATE/DELETE مباشرة من العميل (الاعتماد عبر RPC فقط).
2. دوال SECURITY DEFINER:
   - `request_cross_college_instructor_waiver(...)` — يتطلب `can_manage_college` للكلية الطالبة، ونطاقًا صالحًا (نسخة غير منشورة تابعة للكلية، وقت صحيح)، ويسجل `audit_logs`.
   - `approve_cross_college_instructor_waiver(p_waiver_id, p_reason)` — لمشرف النظام فقط (`has_role(auth.uid(),'super_admin')`)، يثبّت `approved_by/approved_at`، ويُنشئ صف `schedule_version_conflict_exceptions` مطابقًا (`conflict_code='instructor_conflict'`, `approval_type='cross_college_instructor'`) ليعمل معه محرك الاستثناءات والتقارير الحالي، ويسجل `audit_logs`.
   - `revoke_cross_college_instructor_waiver(p_waiver_id, p_reason)` — لمشرف النظام، يحوّل الاستثناء وصف التقارير إلى `revoked`، ويسجل `audit_logs`.
3. تعديل حارس التنسيق `schedule_coordination_private.check_version` ليستثني فقط التقاطعات المغطاة باستثناء `approved` مطابق للنسخة والمحاضر واليوم وداخل الفترة المعتمدة والكلية الأخرى. أي تقاطع آخر يبقى `CROSS_COLLEGE_INSTRUCTOR_CONFLICT` (fail-closed). لا تغيير على أي صف في جدول الآداب.
4. `public._ss_peer_i` يضيف `waiver_id` في تفاصيل التعارض الخارجي عند وجود استثناء معتمد، مع بقاء توليد التعارض كما هو.

### الواجهة والكود
- `src/lib/conflict-engine/cross-college-waivers.ts`: أنواع + استدعاءات الدوال الثلاث + جلب قائمة الاستثناءات لنسخة.
- `src/components/cross-college-waiver-panel.tsx`: القسم الجديد (قائمة + نموذج طلب + اعتماد/إلغاء) بالعربية RTL وبتوكينات التصميم الحالية.
- `src/routes/_authenticated/conflict-checks.tsx`: إدراج القسم أسفل نتائج الفحص، مربوطًا بالنسخة المختارة.
- `tests/cross-college-waiver.test.ts`: مطابقة النطاق (نفس المحاضر/اليوم/داخل الفترة = مغطى؛ يوم أو وقت أو كلية مختلفة = غير مغطى)، ورفض غير المعتمد، ورفض الملغى.

## غير مشمول
- لا تعديل ولا نشر لأي نسخة (بما فيها جدول الآداب المنشور)، ولا إضافة محاضرة البلاغة G1؛ تُضاف بطلب صريح منك بعد اعتماد الاستثناء.
