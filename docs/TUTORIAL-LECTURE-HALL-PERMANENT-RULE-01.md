# TUTORIAL-LECTURE-HALL-PERMANENT-RULE-01

قاعدة دائمة على مستوى المنصة: كل محاضرة `tutorial` (تمارين) يُدرَّس في نوع قاعة
`lecture_hall` فقط. محاضرات `practical` / `project` / `theory` لم تتغير.

## العقد المعتمد

| الحالة                     | النتيجة                                       |
| -------------------------- | --------------------------------------------- |
| tutorial + `lecture_hall`  | مقبول                                         |
| tutorial بدون نوع قاعة     | يُربط تلقائيًا بـ`lecture_hall` النشط للكلية   |
| tutorial + أي نوع آخر      | مرفوض برسالة عربية واضحة (لا تخمين)           |
| لا يوجد `lecture_hall` صالح | فشل صريح                                      |
| practical / project / theory | يمر دون أي تعديل                            |

## طبقة قاعدة البيانات (مطبّقة عبر Lovable-native migration)

الملف: `supabase/migrations/20260911223519_1ca9576b-7d4c-41e8-962e-8ca21c1641ed.sql`

- `public.tutorial_required_room_type_id(uuid)` — SECURITY INVOKER, STABLE،
  ترجع `lecture_hall` النشط ذا السعة > 0 داخل الكلية.
- `enforce_tutorial_lecture_hall_component` + trigger على `plan_course_components`.
- `enforce_tutorial_lecture_hall_assignment` + trigger على `teaching_assignments`.
- backfill idempotent للمحاضرات والإسنادات: بدون تغيير المعرفات أو المجموعات أو أعدادها.

Live postcheck: `triggers=2`, `tutorial components=39`, `tutorial+lecture_hall=39`,
`tutorial assignments=0`.

## طبقة التطبيق

- `src/lib/academic-delivery/tutorial-room-type.ts` — مرآة نقية للقاعدة
  (`resolveTutorialRoomTypeId`, `resolveTutorialAssignmentRoomType`,
  `findTutorialRoomType`, `tutorialRoomTypeIsLocked`).
- `src/lib/academic-delivery/plan-component-room-types.ts` — مسار الاستيراد/المعاينة:
  tutorial لا يقبل نوع قاعة حرًّا؛ يُربط تلقائيًا أو يُرفض بخطأ
  `tutorial_room_type_must_be_lecture_hall` / `tutorial_lecture_hall_room_type_missing`.
- `src/lib/academic-delivery/plan-course-editor.ts` — تحقق + `normalizeComponentFormRoomType`
  قبل أي insert/update.
- `src/components/study-plans/plan-courses-manager.tsx` — عند اختيار «تمارين» يُثبَّت نوع القاعة
  على «قاعة محاضرات» ويُعطَّل الاختيار مع رسالة توضيحية.
- المجدول (`auto-scheduler/v2.ts`) يستخدم `required_room_type_id` للمحاضرة، لذلك لن يُسكن
  محاضرة tutorial إلا في غرف `lecture_hall`.

## النتائج

- `tests/tutorial-lecture-hall-rule.test.ts`: 13 pass / 26 assertions.
- harness: 72 passed / 0 failed (عُدّل `plan-component-room-type-permanent-fix.harness.ts`
  ليعكس أن tutorial لم يعد يُبلَّغ كنوع قاعة مفقود).
- `tsgo --noEmit` نظيف، ESLint على الملفات المعدلة نظيف، `bun run build` PASS.
- لم تُعدّل `src/integrations/supabase/types.ts` ولا المجموعات ولا الجلسات، ولا يوجد نشر.
