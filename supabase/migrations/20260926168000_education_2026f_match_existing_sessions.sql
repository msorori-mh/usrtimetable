-- Reconcile source cells with already-booked sessions without adding hours.
-- Require an unambiguous offering, instructor, cohort and component match.
BEGIN;
DO $match$
DECLARE v_college constant uuid:='1ee291b2-bec9-43d3-b42b-5a4f46946399';
        v_term constant uuid:='93705393-609d-4605-ae94-9572cd8b2090';
        v_version constant uuid:='7430bad7-2de7-5c90-9368-b214a199d6c3';
        before_count integer;
        candidate_count integer;
        session_count integer;
        linked_count integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions WHERE id=v_version)
  THEN RETURN; END IF;
  PERFORM 1 FROM public.schedule_versions v JOIN public.academic_terms t
    ON t.id=v.academic_term_id WHERE v.id=v_version AND v.college_id=v_college
    AND v.status='draft' AND t.id=v_term AND t.academic_year='2026-2027'
    AND t.term_type='first' FOR UPDATE OF v;
  IF NOT FOUND OR NOT public.existing_schedule_intake_enabled(v_college,v_term)
  THEN RAISE EXCEPTION 'EDU26F_MATCH_DRAFT_DRIFT'; END IF;
  SELECT count(*) INTO before_count FROM public.existing_schedule_source_rows
    WHERE college_id=v_college AND term_id=v_term
      AND schedule_version_id=v_version AND schedule_session_id IS NOT NULL;
  IF before_count NOT IN (207,309)
  THEN RAISE EXCEPTION 'EDU26F_MATCH_BASELINE_DRIFT: %',before_count; END IF;

  WITH candidates AS (
    SELECT r.id source_row_id,s.id session_id,s.delivery_group_id,s.cohort_id,
      s.plan_course_component_id,r.component_id source_component_id,
      s.teaching_assignment_id,s.room_id,
      o.study_plan_id,
      count(*) OVER (PARTITION BY r.id) options
    FROM public.existing_schedule_source_rows r
    JOIN public.course_offerings o ON o.plan_course_id=r.plan_course_id
      AND o.term_id=r.term_id AND o.college_id=r.college_id
    JOIN public.schedule_sessions s ON s.course_offering_id=o.id
      AND s.schedule_version_id=r.schedule_version_id
      AND s.instructor_id=ANY(r.instructor_ids)
      AND (r.cohort_id IS NULL OR r.cohort_id=s.cohort_id)
    JOIN public.delivery_groups g ON g.id=s.delivery_group_id
      AND g.cohort_id=s.cohort_id AND g.component_id=s.plan_course_component_id
      AND g.plan_course_id=r.plan_course_id AND g.active AND NOT g.is_obsolete
    WHERE r.college_id=v_college AND r.term_id=v_term
      AND r.schedule_version_id=v_version AND r.schedule_session_id IS NULL
      AND r.status='pending'
      AND r.source_file IN (
        'الجدول الدارسي الفصل الاول 27-نعمان_085037.xlsx',
        'جدول قسم الفيزياء للفصل الاول 1111 2027.docx',
        'جدول قسم اللغة العربية 2027.doc',
        'جدول قسم علوم الحياة للفصل الأول2026-2027م.docx',
        'جدول_الفصل_الأول_2026_ـ_2027م-2.docx')
      AND NOT EXISTS (SELECT 1 FROM public.existing_schedule_source_rows prior
        WHERE prior.schedule_session_id=s.id)
  ), safe AS (SELECT * FROM candidates WHERE options=1
      AND source_component_id=plan_course_component_id)
  SELECT count(*),count(DISTINCT session_id) INTO candidate_count,session_count
    FROM safe;
  IF (before_count=207 AND (candidate_count<>102 OR session_count<>100))
     OR (before_count=309 AND candidate_count<>0)
  THEN RAISE EXCEPTION 'EDU26F_MATCH_CANDIDATE_DRIFT: % / %',candidate_count,session_count; END IF;

  WITH candidates AS (
    SELECT r.id source_row_id,s.id session_id,s.delivery_group_id,s.cohort_id,
      s.plan_course_component_id,r.component_id source_component_id,
      s.teaching_assignment_id,s.room_id,
      o.study_plan_id,count(*) OVER (PARTITION BY r.id) options
    FROM public.existing_schedule_source_rows r
    JOIN public.course_offerings o ON o.plan_course_id=r.plan_course_id
      AND o.term_id=r.term_id AND o.college_id=r.college_id
    JOIN public.schedule_sessions s ON s.course_offering_id=o.id
      AND s.schedule_version_id=r.schedule_version_id
      AND s.instructor_id=ANY(r.instructor_ids)
      AND (r.cohort_id IS NULL OR r.cohort_id=s.cohort_id)
    JOIN public.delivery_groups g ON g.id=s.delivery_group_id
      AND g.cohort_id=s.cohort_id AND g.component_id=s.plan_course_component_id
      AND g.plan_course_id=r.plan_course_id AND g.active AND NOT g.is_obsolete
    WHERE r.college_id=v_college AND r.term_id=v_term
      AND r.schedule_version_id=v_version AND r.schedule_session_id IS NULL
      AND r.status='pending'
      AND r.source_file IN (
        'الجدول الدارسي الفصل الاول 27-نعمان_085037.xlsx',
        'جدول قسم الفيزياء للفصل الاول 1111 2027.docx',
        'جدول قسم اللغة العربية 2027.doc',
        'جدول قسم علوم الحياة للفصل الأول2026-2027م.docx',
        'جدول_الفصل_الأول_2026_ـ_2027م-2.docx')
      AND NOT EXISTS (SELECT 1 FROM public.existing_schedule_source_rows prior
        WHERE prior.schedule_session_id=s.id)
  ), safe AS (SELECT * FROM candidates WHERE options=1
      AND source_component_id=plan_course_component_id)
  UPDATE public.existing_schedule_source_rows r SET
    schedule_session_id=c.session_id,delivery_group_id=c.delivery_group_id,
    cohort_id=c.cohort_id,component_id=c.plan_course_component_id,
    teaching_assignment_id=c.teaching_assignment_id,room_id=c.room_id,
    study_plan_id=coalesce(r.study_plan_id,c.study_plan_id),status='imported',
    pending_reasons=CASE WHEN c.teaching_assignment_id IS NULL THEN
      ARRAY['الجلسة في المسودة دون إسناد إداري معتمد؛ يلزم تحقق الاسم والتكليف.']
      ELSE ARRAY[]::text[] END,
    notes=coalesce(r.notes,'')||E'\n'||
      'مطابقة جلسة موجودة بمقرر ومدرس ودفعة ومكوّن فريد في الفصل الأول 2026-2027. وقت وقاعة الملف محفوظان في حقول المصدر؛ تعرض الواجهة الموعد التشغيلي بجانبه.'
  FROM safe c WHERE r.id=c.source_row_id AND r.schedule_session_id IS NULL;
  GET DIAGNOSTICS linked_count=ROW_COUNT;
  IF linked_count<>candidate_count
  THEN RAISE EXCEPTION 'EDU26F_MATCH_UPDATE_DRIFT: % / %',linked_count,candidate_count; END IF;
END;
$match$;
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
