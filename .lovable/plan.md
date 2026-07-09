## تغيير المصطلحات العربية في جميع أنحاء النظام

سأقوم بتحديث نصوص الواجهة العربية فقط (بدون أي تغيير في أسماء الجداول أو الحقول أو منطق العمل) وفق ما يلي:

### قواعد الاستبدال

| القديم | الجديد |
|---|---|
| الجلسات غير المجدوَلة / جلسات غير مجدولة | المحاضرات غير المجدوَلة / محاضرات غير مجدولة |
| مختبر / المختبر / مختبرات / المختبرات | معمل / المعمل / معامل / المعامل |
| شعبة / الشعبة / شُعب / الشُعب / شعب | مجموعة / المجموعة / مجموعات / المجموعات |

سأراعي المفرد والجمع والتذكير والتأنيث والتعريف والتنكير (مثل: "مختبراً" → "معملاً"، "شعبتان" → "مجموعتان" إن وُجدت).

### نطاق التغيير

- جميع ملفات الواجهة داخل `src/` (routes, components, lib) التي تحتوي على نصوص عربية مرئية للمستخدم:
  - صفحات التقارير (unscheduled, section-timetable, program-level-timetable, room-timetable, department-schedule, published-timetable, instructor-schedule, conflicts, room-utilization, index)
  - صفحات النظام الأساسية: sections, rooms, room-types, session-types, course-offerings, teaching-assignments, auto-schedule, conflict-checks, data-readiness, data-cleanup, import, scheduling-settings, timetable, schedule-versions
  - المكوّنات: `app-layout.tsx` (روابط القائمة الجانبية)، `session-dialog.tsx`، `timetable-grid`
  - مكتبات النصوص: `data-templates/catalog.ts`، `excel-import/templates.ts`، `excel-import/validators.ts`، `excel-import/commit.ts`، `reports/readiness.ts`، `reports/session-mappers.ts`، `conflict-engine/{scorer,validator}.ts`، `auto-scheduler/greedy.ts`، `branding/usr.ts`

### ما لن يتغيّر

- أسماء الجداول والأعمدة في قاعدة البيانات (مثل `sections`, `lab`, `schedule_sessions`) وقيم الـ enum الإنجليزية.
- ملفات الـ migrations السابقة (تاريخية).
- الكود المنطقي، وأسماء المتغيّرات، والـ keys الإنجليزية.
- المصطلحات الإنجليزية في التعليقات والأكواد.

### طريقة التنفيذ

1. البحث الشامل بـ ripgrep لالتقاط كل صيغ الكلمات الثلاث.
2. تطبيق الاستبدال ملفاً ملفاً عبر تعديلات موضعية للحفاظ على التنسيق.
3. مراجعة سريعة للنتائج للتأكد من عدم تغيير أي مفتاح تقني أو نص إنجليزي.
4. التحقق من البناء (build/typecheck) بعد الانتهاء.
