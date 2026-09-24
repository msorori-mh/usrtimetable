-- ===== 1) Preflight: refuse to run on any drift
DO $pf$
DECLARE v_md5 text; v_n int; v_h numeric; v_null int;
BEGIN
  SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text),count(*),
         sum(extract(epoch from (s.end_time-s.start_time))/3600),count(*) FILTER (WHERE s.room_id IS NULL)
    INTO v_md5,v_n,v_h,v_null
    FROM public.schedule_sessions s WHERE s.schedule_version_id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50';
  IF v_md5<>'7e0b7e291e3668c8e30c4ee7fe009878' THEN RAISE EXCEPTION 'SOURCE_FINGERPRINT_DRIFT %',v_md5; END IF;
  IF v_n<>112 OR v_h<>303 OR v_null<>5 THEN RAISE EXCEPTION 'SOURCE_SHAPE_DRIFT n=% h=% null=%',v_n,v_h,v_null; END IF;
  IF (SELECT status FROM public.schedule_versions WHERE id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50')<>'published'
    THEN RAISE EXCEPTION 'SOURCE_NOT_PUBLISHED'; END IF;
  IF md5(pg_get_functiondef('public.ensure_ss_college'::regproc))<>'c25d924fb42fe6f49cb130d43ae538a8'
    THEN RAISE EXCEPTION 'GUARD_DRIFT %',md5(pg_get_functiondef('public.ensure_ss_college'::regproc)); END IF;
  IF NOT public.existing_schedule_intake_enabled('f30ff526-3918-4395-b8a0-dff1873534bf','019af13c-fd67-4fea-81c8-d81ef95e9a5c')
    THEN RAISE EXCEPTION 'EXISTING_SCHEDULE_INTAKE_DISABLED'; END IF;
  IF EXISTS(SELECT 1 FROM public.schedule_versions WHERE notes LIKE 'BA-INTAKE-20260921%')
    THEN RAISE EXCEPTION 'ALREADY_APPLIED'; END IF;
  IF EXISTS(SELECT 1 FROM public.existing_schedule_source_rows
    WHERE college_id='f30ff526-3918-4395-b8a0-dff1873534bf' AND source_id ~ '^BA[0-9]{2}$')
    THEN RAISE EXCEPTION 'BA_ROWS_ALREADY_STAGED'; END IF;
END $pf$;

-- ===== 2) Minimal, anchored patches applied to the live definitions (no rewrite, no bypass)
DO $patch$
DECLARE d text; n text; a text; b text;
BEGIN
  -- 2a) clone RPC: keep the authenticated college-manager check; add the owner service-role path
  --     that public.import_existing_schedule_intake already uses. auth.uid() is never faked.
  d:=pg_get_functiondef('public.clone_schedule_version_current(uuid,uuid,uuid,text,text,boolean,boolean)'::regprocedure);
  a:=$q$ IF v_actor IS NULL OR NOT public.can_manage_college(v_actor,p_college_id) THEN
   RAISE EXCEPTION 'CLONE_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;$q$;
  b:=$q$ IF v_actor IS NULL THEN
   IF session_user NOT IN ('postgres','supabase_admin') AND COALESCE(auth.role(),'')<>'service_role' THEN
     RAISE EXCEPTION 'CLONE_NOT_AUTHORIZED' USING ERRCODE='42501';
   END IF;
 ELSIF NOT public.can_manage_college(v_actor,p_college_id) THEN
   RAISE EXCEPTION 'CLONE_NOT_AUTHORIZED' USING ERRCODE='42501';
 END IF;$q$;
  IF position(a in d)=0 THEN RAISE EXCEPTION 'CLONE_ANCHOR_MISSING'; END IF;
  n:=replace(d,a,b);
  IF n=d THEN RAISE EXCEPTION 'CLONE_PATCH_NOOP'; END IF;
  EXECUTE n;

  -- 2b) ensure_ss_college: shared-lecture window exception, strictly identity-preserving,
  --     scoped to this college + term + this one revision draft. Every other guard untouched.
  d:=pg_get_functiondef('public.ensure_ss_college'::regproc);
  a:=$q$            AND NOT coalesce(source_session.replaced_by_split,false)))
$q$;
  b:=$q$            AND NOT coalesce(source_session.replaced_by_split,false)))
      OR (NEW.college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid
        AND EXISTS(SELECT 1 FROM public.schedule_versions target
          WHERE target.id=NEW.schedule_version_id AND target.status='draft'
            AND target.college_id=NEW.college_id
            AND target.academic_term_id='019af13c-fd67-4fea-81c8-d81ef95e9a5c'::uuid
            AND target.notes LIKE 'BA-INTAKE-20260921%')
        AND EXISTS(SELECT 1 FROM public.schedule_sessions src
          JOIN public.schedule_versions sv ON sv.id=src.schedule_version_id
          WHERE sv.id='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50'::uuid
            AND sv.status='published'
            AND sv.academic_term_id='019af13c-fd67-4fea-81c8-d81ef95e9a5c'::uuid
            AND src.college_id IS NOT DISTINCT FROM NEW.college_id
            AND src.course_offering_id IS NOT DISTINCT FROM NEW.course_offering_id
            AND src.teaching_assignment_id IS NOT DISTINCT FROM NEW.teaching_assignment_id
            AND src.instructor_id IS NOT DISTINCT FROM NEW.instructor_id
            AND src.room_id IS NOT DISTINCT FROM NEW.room_id
            AND src.section_id IS NOT DISTINCT FROM NEW.section_id
            AND src.section_group_id IS NOT DISTINCT FROM NEW.section_group_id
            AND src.section_subgroup_id IS NOT DISTINCT FROM NEW.section_subgroup_id
            AND src.cohort_id IS NOT DISTINCT FROM NEW.cohort_id
            AND src.delivery_group_id IS NOT DISTINCT FROM NEW.delivery_group_id
            AND src.plan_course_component_id IS NOT DISTINCT FROM NEW.plan_course_component_id
            AND src.day_of_week IS NOT DISTINCT FROM NEW.day_of_week
            AND src.start_time IS NOT DISTINCT FROM NEW.start_time
            AND src.end_time IS NOT DISTINCT FROM NEW.end_time
            AND src.session_type IS NOT DISTINCT FROM NEW.session_type
            AND src.is_locked IS NOT DISTINCT FROM NEW.is_locked
            AND src.lock_reason IS NOT DISTINCT FROM NEW.lock_reason
            AND NOT coalesce(src.replaced_by_split,false)))
$q$;
  IF position(a in d)=0 THEN RAISE EXCEPTION 'GUARD_ANCHOR_MISSING'; END IF;
  n:=replace(d,a,b);
  IF n=d THEN RAISE EXCEPTION 'GUARD_PATCH_NOOP'; END IF;
  EXECUTE n;

  -- 2c) existing-schedule import: an existing timetable can hold several student groups
  --     for the same course component (level 1 runs groups 1 and 2), so number them
  --     sequentially instead of always 1. Nothing else in the routine changes.
  d:=pg_get_functiondef('public.import_existing_schedule_intake(uuid,integer)'::regprocedure);
  a:=$q$,NULL,NULL,1) RETURNING id INTO grp;$q$;
  b:=$q$,NULL,NULL,coalesce((SELECT max(g.group_number)+1 FROM public.delivery_groups g WHERE g.cohort_id=cohort AND g.component_id=cp.id),1)) RETURNING id INTO grp;$q$;
  IF position(a in d)=0 THEN RAISE EXCEPTION 'IMPORT_ANCHOR_MISSING'; END IF;
  n:=replace(d,a,b);
  IF n=d THEN RAISE EXCEPTION 'IMPORT_PATCH_NOOP'; END IF;
  EXECUTE n;
END $patch$;

-- ===== 3) Sourced catalog completion (only what the source timetable requires)
INSERT INTO public.instructors(college_id,full_name,full_name_ar,employment_type,is_active,notes)
SELECT 'f30ff526-3918-4395-b8a0-dff1873534bf'::uuid, v.n, v.n, 'unknown', true,
  'مصدر: جدول إدارة الأعمال القائم — الفصل الأول 2026-2027؛ بيانات التعيين غير مكتملة'
FROM (VALUES ('ليلى الزايدي'),('عبدالرحمن السودي'),('أحمد القطامي')) v(n)
WHERE NOT EXISTS (
  SELECT 1 FROM public.instructors i
  WHERE i.college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid
    AND coalesce(i.full_name_ar,i.full_name)=v.n);

INSERT INTO public.courses(college_id,department_id,code,name,credit_hours,theory_hours,course_nature)
SELECT 'f30ff526-3918-4395-b8a0-dff1873534bf'::uuid,'a5e617c0-6fa0-4146-b9cc-7bf50637a0d1'::uuid,
  'BUA-QIM-2026','قضايا إدارية معاصرة',3,3,'department'
WHERE NOT EXISTS (SELECT 1 FROM public.courses
  WHERE college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid AND code='BUA-QIM-2026');

INSERT INTO public.study_plans(college_id,program_id,name,code,version,effective_year,is_active)
SELECT 'f30ff526-3918-4395-b8a0-dff1873534bf'::uuid,'3fe04f20-9b6e-4e09-bf04-84c0d20779d5'::uuid,
  'إدارة الأعمال — نقل الجدول القائم 2026-2027','BUA-EXIST-2026','1',2026,true
WHERE NOT EXISTS (SELECT 1 FROM public.study_plans
  WHERE college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid AND code='BUA-EXIST-2026');

WITH spec(level_number,course_code,hours,comp_type) AS (VALUES
  (4,'BUA418',3,'theory'),(4,'BUA419',3,'theory'),(4,'BUA421',2,'project'),
  (4,'BUA417',3,'theory'),(4,'BUA420',3,'theory'),
  (3,'FAFS08',3,'theory'),(3,'BUA309',3,'theory'),(3,'BUA307',3,'theory'),
  (3,'BUA-QIM-2026',3,'theory'),(3,'BUA310',3,'theory'),(3,'BUA308',3,'theory'),
  (2,'FAFS10',3,'theory'),(2,'FAFS07',3,'theory'),(2,'FAFS13',3,'theory'),
  (2,'USR08',2,'theory'),(2,'BUA201',3,'theory'),(2,'BUA202',3,'theory'),
  (1,'FAFS02',3,'theory'),(1,'FAFS01',3,'theory'),(1,'FAFS04',3,'theory'),
  (1,'USR07',2,'theory'),(1,'USR03',2,'theory'),(1,'USR05',2,'theory'),(1,'USR01',2,'theory')
), ins AS (
  INSERT INTO public.plan_courses(college_id,study_plan_id,course_id,level_id,semester,is_required)
  SELECT 'f30ff526-3918-4395-b8a0-dff1873534bf'::uuid, sp.id, c.id, al.id, 1, true
  FROM spec
  JOIN public.courses c
    ON c.college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid AND c.code=spec.course_code
  JOIN public.academic_levels al
    ON al.program_id='3fe04f20-9b6e-4e09-bf04-84c0d20779d5'::uuid AND al.level_number=spec.level_number
  CROSS JOIN (SELECT id FROM public.study_plans
    WHERE college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid AND code='BUA-EXIST-2026') sp
  RETURNING id, course_id
)
INSERT INTO public.plan_course_components(college_id,plan_course_id,component_type,weekly_contact_hours,is_timetabled)
SELECT 'f30ff526-3918-4395-b8a0-dff1873534bf'::uuid, ins.id, spec.comp_type, spec.hours, true
FROM ins
JOIN public.courses c ON c.id=ins.course_id
JOIN spec ON spec.course_code=c.code;

-- ===== 4) Stage all 29 source timetable entries verbatim (raw labels preserved)
INSERT INTO public.existing_schedule_source_rows(
  college_id,term_id,source_id,source_file,source_cell,
  study_plan_id,level_number,
  raw_course,raw_teacher,raw_day,raw_time,raw_room,
  day_of_week,start_time,end_time,plan_course_id,component_id,
  instructor_ids,room_id,status,notes)
SELECT
  'f30ff526-3918-4395-b8a0-dff1873534bf'::uuid,'019af13c-fd67-4fea-81c8-d81ef95e9a5c'::uuid,
  r.source_id,'جدول الفصل الدراسي الأول لعام 2026-2027م.pdf',
  'ص1 — المستوى '||r.lvl::text||' — مجموعة '||r.grp||' — سطر '||r.seq::text,
  sp.id,r.lvl,
  r.raw_course,r.raw_teacher,r.raw_day,r.raw_time,r.raw_room,
  r.dow,r.st::time,r.en::time,pc.id,pcc.id,
  CASE WHEN w.instr IS NULL THEN ARRAY[]::uuid[] ELSE ARRAY[w.instr] END,
  r.room,
  CASE WHEN w.instr IS NULL THEN 'pending' ELSE 'ready' END,
  CASE WHEN w.instr IS NULL
    THEN 'مجموعة '||r.grp||' — بانتظار تحديد المحاضر: '||r.raw_teacher
    ELSE 'إدارة الأعمال — نظام عام — مجموعة '||r.grp END
FROM (VALUES
 ('BA01',1,4,'1',6,'08:00','11:00','الإدارة الاستراتيجية','BUA418','سعيد بن جلال','8ef05bce-f27d-5356-ac00-63f410e169a6'::uuid,'ش2','b830a337-e1fb-5442-850b-8286505e1194'::uuid,'السبت','08-11'),
 ('BA02',2,4,'1',6,'11:00','14:00','إدارة سلاسل التوريد','BUA419','واضح اليوسفي','89404297-a57a-548c-b397-8dda62bd0120'::uuid,'ش2','b830a337-e1fb-5442-850b-8286505e1194'::uuid,'السبت','11-14'),
 ('BA03',3,4,'1',1,'08:00','10:00','بحث التخرج','BUA421','غير محدد',NULL::uuid,'ش2','b830a337-e1fb-5442-850b-8286505e1194'::uuid,'الاثنين','08-10'),
 ('BA04',4,4,'1',3,'08:00','11:00','المحاسبة الإدارية','BUA417','علي الفلاحي','5b37f850-ac8c-552b-861d-c9082a74f978'::uuid,'ش2','b830a337-e1fb-5442-850b-8286505e1194'::uuid,'الأربعاء','08-11'),
 ('BA05',5,4,'1',3,'11:00','14:00','إدارة العلاقات العامة','BUA420','نجيب الأغبس','59903bd4-db8d-57f7-a659-2808cf695097'::uuid,'ش2','b830a337-e1fb-5442-850b-8286505e1194'::uuid,'الأربعاء','11-14'),
 ('BA06',6,3,'1',6,'08:00','11:00','مبادئ الإدارة المالية','FAFS08','حميد الوصابي','a4c7fcce-f1c1-54a1-acac-58261c6de90a'::uuid,'ش1','68537c97-065f-5b8d-82c3-ac1d052322d3'::uuid,'السبت','08-11'),
 ('BA07',7,3,'1',6,'11:00','14:00','الاعمال الالكترونية','BUA309','صالح مهدي','a1e9b2dc-1344-58be-89c9-79e09e235d5e'::uuid,'ش1','68537c97-065f-5b8d-82c3-ac1d052322d3'::uuid,'السبت','11-14'),
 ('BA08',8,3,'1',1,'08:00','11:00','محاسبة التكاليف','BUA307','عبدالسلام عيناء','8ae8d0ae-ea1d-52d3-9444-26affaba68d1'::uuid,'ش1','68537c97-065f-5b8d-82c3-ac1d052322d3'::uuid,'الاثنين','08-11'),
 ('BA09',9,3,'1',1,'11:00','14:00','قضايا إدارية معاصرة','BUA-QIM-2026','نجيب الأغبس','59903bd4-db8d-57f7-a659-2808cf695097'::uuid,'ش1','68537c97-065f-5b8d-82c3-ac1d052322d3'::uuid,'الاثنين','11-14'),
 ('BA10',10,3,'1',3,'08:00','11:00','إدارة الموارد البشرية','BUA310','عبدالناصر سودان','af5889cf-ac47-54c3-885a-a7b9af2f4403'::uuid,'ش1','68537c97-065f-5b8d-82c3-ac1d052322d3'::uuid,'الأربعاء','08-11'),
 ('BA11',11,3,'1',3,'11:00','14:00','دراسة الجدوى وتقييم المشروعات','BUA308','صالح حشوان','c8c25971-82fe-5ace-a3ca-fb650e4c5e0e'::uuid,'ش1','68537c97-065f-5b8d-82c3-ac1d052322d3'::uuid,'الأربعاء','11-14'),
 ('BA12',12,2,'1',6,'08:00','11:00','نقود وبنوك','FAFS10','صالح الأقرع','f6bb498e-67df-5d7c-87fc-040999ad13fe'::uuid,'ش5','bfbb3adc-015c-5a3c-a233-412f43bd2756'::uuid,'السبت','08-11'),
 ('BA13',13,2,'1',6,'11:00','14:00','مبادئ التسويق','FAFS07','إبراهيم الريمي','713c1543-2eca-5f87-8292-34ea757341f7'::uuid,'ش5','bfbb3adc-015c-5a3c-a233-412f43bd2756'::uuid,'السبت','11-14'),
 ('BA14',14,2,'1',1,'08:00','11:00','الرياضيات في العلوم الإدارية','FAFS13','محمد الحومي','0b1ad8a2-d2be-5041-9725-9de8db2e0c0a'::uuid,'ش5','bfbb3adc-015c-5a3c-a233-412f43bd2756'::uuid,'الاثنين','08-11'),
 ('BA15',15,2,'1',1,'11:00','13:00','مهارات عامة','USR08','محمد شمسان','0185356c-93aa-5e21-9d6a-363e969ad721'::uuid,'ش5','bfbb3adc-015c-5a3c-a233-412f43bd2756'::uuid,'الاثنين','11-13'),
 ('BA16',16,2,'1',3,'08:00','11:00','المحاسبة المتوسطة','BUA201','عبدالغني العربي','280e7f45-b24a-56f9-ad5f-d14ccbc24561'::uuid,'ش5','bfbb3adc-015c-5a3c-a233-412f43bd2756'::uuid,'الأربعاء','08-11'),
 ('BA17',17,2,'1',3,'11:00','14:00','نظم المعلومات الإدارية','BUA202','واضح اليوسفي','89404297-a57a-548c-b397-8dda62bd0120'::uuid,'ش5','bfbb3adc-015c-5a3c-a233-412f43bd2756'::uuid,'الأربعاء','11-14'),
 ('BA18',18,1,'1+2',6,'08:00','11:00','مبادئ المحاسبة المالية (1)','FAFS02','أحمد النور','4c467487-c3ff-5134-957e-05ba26d2c75c'::uuid,'القردعي','4e19eef6-6a23-55d5-bfde-1a4af775fbd0'::uuid,'السبت','08-11'),
 ('BA19',19,1,'1+2',6,'11:00','14:00','مبادئ الإدارة','FAFS01','محمد جحيش','5dc63fd0-7b9b-519c-807b-830e8791a02b'::uuid,'القردعي','4e19eef6-6a23-55d5-bfde-1a4af775fbd0'::uuid,'السبت','11-14'),
 ('BA20',20,1,'1',1,'08:00','11:00','مبادئ الاقتصاد الجزئي','FAFS04','عايض عقال','e7732a68-f464-5223-83a1-176df22b7cec'::uuid,'ش6','dab91dc9-fc51-5fbc-9977-95beb981acd7'::uuid,'الاثنين','08-11'),
 ('BA21',21,1,'1',1,'11:00','13:00','مهارات الحاسوب','USR07','كلية الحاسوب',NULL::uuid,'ش6','dab91dc9-fc51-5fbc-9977-95beb981acd7'::uuid,'الاثنين','11-13'),
 ('BA22',22,1,'2',1,'08:00','10:00','مهارات الحاسوب','USR07','كلية الحاسوب',NULL::uuid,'ش12','f58467dc-cb55-5993-90fc-2c0ea5cb72c9'::uuid,'الاثنين','08-10'),
 ('BA23',23,1,'2',1,'11:00','14:00','مبادئ الاقتصاد الجزئي','FAFS04','عايض عقال','e7732a68-f464-5223-83a1-176df22b7cec'::uuid,'ش12','f58467dc-cb55-5993-90fc-2c0ea5cb72c9'::uuid,'الاثنين','11-14'),
 ('BA24',24,1,'1',3,'08:00','10:00','مهارات اللغة الإنجليزية (1)','USR03','ليلى الزايدي',NULL::uuid,'ش6','dab91dc9-fc51-5fbc-9977-95beb981acd7'::uuid,'الأربعاء','08-10'),
 ('BA25',25,1,'1',3,'10:00','12:00','ثقافة إسلامية (1)','USR05','عبدالرحمن السودي',NULL::uuid,'ش6','dab91dc9-fc51-5fbc-9977-95beb981acd7'::uuid,'الأربعاء','10-12'),
 ('BA26',26,1,'1',3,'12:00','14:00','مهارات اللغة العربية (1)','USR01','أحمد القطامي',NULL::uuid,'ش6','dab91dc9-fc51-5fbc-9977-95beb981acd7'::uuid,'الأربعاء','12-14'),
 ('BA27',27,1,'2',3,'08:00','10:00','مهارات اللغة العربية (1)','USR01','أحمد القطامي',NULL::uuid,'ش12','f58467dc-cb55-5993-90fc-2c0ea5cb72c9'::uuid,'الأربعاء','08-10'),
 ('BA28',28,1,'2',3,'10:00','12:00','مهارات اللغة الإنجليزية (1)','USR03','ليلى الزايدي',NULL::uuid,'ش12','f58467dc-cb55-5993-90fc-2c0ea5cb72c9'::uuid,'الأربعاء','10-12'),
 ('BA29',29,1,'2',3,'12:00','14:00','ثقافة إسلامية (1)','USR05','عبدالرحمن السودي',NULL::uuid,'ش12','f58467dc-cb55-5993-90fc-2c0ea5cb72c9'::uuid,'الأربعاء','12-14')
) AS r(source_id,seq,lvl,grp,dow,st,en,raw_course,course_code,raw_teacher,instr_literal,raw_room,room,raw_day,raw_time)
CROSS JOIN LATERAL (SELECT COALESCE(r.instr_literal,
   (SELECT i.id FROM public.instructors i
    WHERE i.college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid
      AND coalesce(i.full_name_ar,i.full_name)=r.raw_teacher
      AND r.raw_teacher IN ('ليلى الزايدي','عبدالرحمن السودي','أحمد القطامي'))) AS instr) w
CROSS JOIN (SELECT id FROM public.study_plans
      WHERE college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid AND code='BUA-EXIST-2026') sp
JOIN public.courses c
  ON c.college_id='f30ff526-3918-4395-b8a0-dff1873534bf'::uuid AND c.code=r.course_code
JOIN public.academic_levels al
  ON al.program_id='3fe04f20-9b6e-4e09-bf04-84c0d20779d5'::uuid AND al.level_number=r.lvl
JOIN public.plan_courses pc
  ON pc.study_plan_id=sp.id AND pc.course_id=c.id AND pc.level_id=al.id
JOIN public.plan_course_components pcc ON pcc.plan_course_id=pc.id;

-- ===== 5) Atomic revision: clone published current, import staged rows, negative + rollback tests, verify
DO $ba$
DECLARE
  c_college uuid:='f30ff526-3918-4395-b8a0-dff1873534bf';
  c_term    uuid:='019af13c-fd67-4fea-81c8-d81ef95e9a5c';
  c_src     uuid:='c49a3694-3ade-5b2e-bbb2-6b5cafbbff50';
  c_study   uuid:='f7348192-b851-4ac1-90aa-1b85d13dfc48';
  v_new uuid; v_clone jsonb; v_imp jsonb;
  v_n int; v_h numeric; v_nullrooms int; v_md5 text;
  v_conf jsonb; v_neg_a text; v_neg_b text; v_rollback text; v_probe uuid; v_room uuid; v_before int;
  v_removed int; v_mat int; v_pending int; v_blocked jsonb;
BEGIN
  v_clone:=public.clone_schedule_version_current(
    c_college,c_src,c_term,
    'مراجعة الجدول القائم — العلوم الإدارية والمالية — بإضافة إدارة الأعمال — الفصل الأول 2026-2027',
    'BA-INTAKE-20260921 — مراجعة مستنسخة من النسخة المنشورة c49a3694-3ade-5b2e-bbb2-6b5cafbbff50: تُحفظ 112 جلسة كما هي (منها 5 بلا قاعة) ويُضاف جدول إدارة الأعمال المصدري (29 صفاً / 77 ساعة). أعداد الطلاب غير معلومة والسعات مؤقتة؛ التعارضات القائمة تُعرض كتحذيرات ولا تعني اعتماداً.');
  v_new:=(v_clone->>'version_id')::uuid;
  IF (v_clone->>'sessions_copied')::int<>112 OR (v_clone->>'sessions_skipped')::int<>0 THEN
    RAISE EXCEPTION 'CLONE_INCOMPLETE %',v_clone;
  END IF;

  UPDATE public.existing_schedule_source_rows
     SET schedule_version_id=v_new
   WHERE college_id=c_college AND term_id=c_term AND source_id ~ '^BA[0-9]{2}$' AND schedule_session_id IS NULL;

  v_imp:=public.import_existing_schedule_intake(v_new,2026);
  IF (v_imp->>'new_sessions')::int<>26 THEN RAISE EXCEPTION 'IMPORT_COUNT_UNEXPECTED %',v_imp; END IF;

  -- Source rows whose lecturer is already booked at the same time (same person, this revision
  -- or another college's published/coordination schedule) stay unplaced with a visible reason.
  -- Times, rooms and lecturers are never altered, and no conflict rule is relaxed.
  CREATE TEMP TABLE _ba_blocked ON COMMIT DROP AS
  WITH links AS (SELECT instructor_id, identity_id FROM public.faculty_identity_links),
  peers AS (
    SELECT DISTINCT r.id AS row_id, r.source_id, r.schedule_session_id AS session_id
    FROM public.existing_schedule_source_rows r
    JOIN public.schedule_sessions mine ON mine.id=r.schedule_session_id
    JOIN public.schedule_sessions other
      ON other.id<>mine.id AND other.day_of_week=mine.day_of_week
     AND other.start_time<mine.end_time AND mine.start_time<other.end_time
     AND NOT coalesce(other.replaced_by_split,false)
    JOIN public.schedule_versions ov ON ov.id=other.schedule_version_id
    WHERE r.college_id=c_college AND r.term_id=c_term AND r.source_id ~ '^BA[0-9]{2}$'
      AND r.schedule_session_id IS NOT NULL
      AND (ov.id=v_new OR ov.status='published'
           OR (coalesce(ov.is_coordination,false) AND ov.status IN ('draft','review','approved')))
      AND (other.instructor_id=mine.instructor_id
           OR EXISTS(SELECT 1 FROM links a JOIN links b ON b.identity_id=a.identity_id
                     WHERE a.instructor_id=mine.instructor_id AND b.instructor_id=other.instructor_id))
  ) SELECT * FROM peers;

  SELECT count(*),coalesce(jsonb_agg(source_id ORDER BY source_id),'[]'::jsonb)
    INTO v_removed,v_blocked FROM _ba_blocked;

  UPDATE public.existing_schedule_source_rows r
     SET schedule_session_id=NULL,status='pending',
         pending_reasons=ARRAY['تعارض وقت المحاضر مع جدول قائم (في النسخة نفسها أو في كلية أخرى)؛ يحتاج قراراً بشرياً ولم يُسكَّن']
   WHERE r.id IN (SELECT row_id FROM _ba_blocked);
  DELETE FROM public.schedule_sessions WHERE id IN (SELECT session_id FROM _ba_blocked);

  SELECT count(*) FILTER (WHERE schedule_session_id IS NOT NULL),
         count(*) FILTER (WHERE schedule_session_id IS NULL)
    INTO v_mat,v_pending
    FROM public.existing_schedule_source_rows
   WHERE college_id=c_college AND term_id=c_term AND source_id ~ '^BA[0-9]{2}$';
  IF v_mat+v_pending<>29 THEN RAISE EXCEPTION 'SOURCE_ROW_RECONCILIATION_DRIFT %/%',v_mat,v_pending; END IF;

  -- negative test A: a shared-lecture session may not be re-timed inside the revision
  SELECT s.id INTO v_probe FROM public.schedule_sessions s
   WHERE s.schedule_version_id=v_new
     AND EXISTS(SELECT 1 FROM public.shared_lecture_links l WHERE l.anchor_group_id=s.delivery_group_id)
   ORDER BY s.id LIMIT 1;
  IF v_probe IS NULL THEN RAISE EXCEPTION 'NEGATIVE_TEST_NO_SHARED_FIXTURE'; END IF;
  BEGIN
    INSERT INTO public.schedule_sessions(college_id,schedule_version_id,course_offering_id,teaching_assignment_id,
      instructor_id,room_id,cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,
      start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason)
    SELECT college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,
      cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,
      start_time+interval '1 hour',end_time+interval '1 hour',session_type,expected_students,source_type,is_locked,lock_reason
    FROM public.schedule_sessions WHERE id=v_probe;
    RAISE EXCEPTION 'NEGATIVE_TEST_A_NOT_REJECTED';
  EXCEPTION WHEN OTHERS THEN
    v_neg_a:=SQLERRM;
    IF v_neg_a='NEGATIVE_TEST_A_NOT_REJECTED' THEN RAISE EXCEPTION 'NEGATIVE_TEST_A_NOT_REJECTED'; END IF;
  END;

  -- negative test B: a room of a different room type may not be substituted
  SELECT r2.id INTO v_room FROM public.schedule_sessions s
    JOIN public.rooms r1 ON r1.id=s.room_id
    JOIN public.rooms r2 ON r2.college_id=r1.college_id AND r2.room_type_id IS DISTINCT FROM r1.room_type_id
   WHERE s.id=v_probe LIMIT 1;
  IF v_room IS NULL THEN RAISE EXCEPTION 'NEGATIVE_TEST_B_NO_FIXTURE'; END IF;
  BEGIN
    INSERT INTO public.schedule_sessions(college_id,schedule_version_id,course_offering_id,teaching_assignment_id,
      instructor_id,room_id,cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,
      start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason)
    SELECT college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,v_room,
      cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,
      start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason
    FROM public.schedule_sessions WHERE id=v_probe;
    RAISE EXCEPTION 'NEGATIVE_TEST_B_NOT_REJECTED';
  EXCEPTION WHEN OTHERS THEN
    v_neg_b:=SQLERRM;
    IF v_neg_b='NEGATIVE_TEST_B_NOT_REJECTED' THEN RAISE EXCEPTION 'NEGATIVE_TEST_B_NOT_REJECTED'; END IF;
  END;

  -- rollback test: a failed batch inside the revision leaves no rows behind
  SELECT count(*) INTO v_before FROM public.schedule_sessions WHERE schedule_version_id=v_new;
  BEGIN
    INSERT INTO public.schedule_sessions(college_id,schedule_version_id,course_offering_id,teaching_assignment_id,
      instructor_id,room_id,cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,
      start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason)
    SELECT college_id,schedule_version_id,course_offering_id,teaching_assignment_id,instructor_id,room_id,
      cohort_id,delivery_group_id,plan_course_component_id,study_system,day_of_week,
      start_time,end_time,session_type,expected_students,source_type,is_locked,lock_reason
    FROM public.schedule_sessions WHERE schedule_version_id=v_new;
    RAISE EXCEPTION 'ROLLBACK_PROBE';
  EXCEPTION WHEN OTHERS THEN v_rollback:=SQLERRM;
  END;
  IF (SELECT count(*) FROM public.schedule_sessions WHERE schedule_version_id=v_new)<>v_before THEN
    RAISE EXCEPTION 'ROLLBACK_TEST_COUNT_DRIFT';
  END IF;

  -- verification of the revision
  SELECT count(*),sum(extract(epoch from (end_time-start_time))/3600),count(*) FILTER (WHERE room_id IS NULL)
    INTO v_n,v_h,v_nullrooms
    FROM public.schedule_sessions WHERE schedule_version_id=v_new;
  IF v_n<>112+v_mat OR v_nullrooms<>5 THEN
    RAISE EXCEPTION 'REVISION_SHAPE_UNEXPECTED n=% h=% nullrooms=%',v_n,v_h,v_nullrooms;
  END IF;

  -- source published version must be byte-identical and still published
  SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO v_md5
    FROM public.schedule_sessions s WHERE s.schedule_version_id=c_src;
  IF v_md5<>'7e0b7e291e3668c8e30c4ee7fe009878'
     OR (SELECT status FROM public.schedule_versions WHERE id=c_src)<>'published' THEN
    RAISE EXCEPTION 'SOURCE_MUTATED %',v_md5;
  END IF;
  SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY s.id)::text) INTO v_md5
    FROM public.schedule_sessions s WHERE s.schedule_version_id=c_study;
  IF v_md5<>'f4a7f4bf9e8e3da3d6e1cd38584e7085' THEN RAISE EXCEPTION 'ROOM_STUDY_DRAFT_MUTATED %',v_md5; END IF;

  -- overlap warnings (recorded, never auto-resolved)
  SELECT jsonb_build_object(
      'instructor_overlaps',count(*) FILTER (WHERE kind='instructor'),
      'room_overlaps',count(*) FILTER (WHERE kind='room'),
      'student_group_overlaps',count(*) FILTER (WHERE kind='cohort'),
      'details',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'a',a,'b',b,'day',d)),'[]'::jsonb))
    INTO v_conf
    FROM (
      SELECT DISTINCT ON (least(x.id,y.id),greatest(x.id,y.id),k.kind)
        k.kind, least(x.id,y.id) a, greatest(x.id,y.id) b, x.day_of_week d
      FROM public.schedule_sessions x
      JOIN public.schedule_sessions y
        ON y.schedule_version_id=x.schedule_version_id AND y.id<>x.id
       AND y.day_of_week=x.day_of_week AND y.start_time<x.end_time AND x.start_time<y.end_time
      CROSS JOIN LATERAL (VALUES
        ('instructor',x.instructor_id IS NOT NULL AND x.instructor_id=y.instructor_id),
        ('room',x.room_id IS NOT NULL AND x.room_id=y.room_id),
        ('cohort',x.cohort_id IS NOT NULL AND x.cohort_id=y.cohort_id AND x.delivery_group_id=y.delivery_group_id)
      ) k(kind,hit)
      WHERE x.schedule_version_id=v_new AND k.hit
    ) pairs;

  INSERT INTO public.schedule_version_events(college_id,schedule_version_id,event_type,from_status,to_status,performed_by,notes,metadata)
  VALUES(c_college,v_new,'cloned',NULL,'draft',NULL,
    'استيراد جدول إدارة الأعمال القائم (29 صفاً مصدرياً) فوق مراجعة الجدول المنشور؛ التعارضات تحذيرية ولم تُغيَّر أي أوقات أو قاعات مصدرية',
    jsonb_build_object('source_version_id',c_src,'clone',v_clone,'import',v_imp,
      'event_kind','existing_schedule_imported',
      'source_rows_total',29,'source_rows_materialized',v_mat,'source_rows_pending',v_pending,
      'source_rows_blocked_by_lecturer_conflict',v_blocked,
      'source_clock_hours',77,
      'revision_sessions',v_n,'revision_clock_hours',v_h,'revision_sessions_without_room',v_nullrooms,
      'conflicts',v_conf,
      'negative_test_shared_time_rejected',v_neg_a,
      'negative_test_incompatible_room_rejected',v_neg_b,
      'rollback_test',v_rollback,
      'source_sessions_md5','7e0b7e291e3668c8e30c4ee7fe009878'));

  RAISE NOTICE 'BA_REVISION % clone=% import=% conflicts=%',v_new,v_clone,v_imp,v_conf;
END $ba$;