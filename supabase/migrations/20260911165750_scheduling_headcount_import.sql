-- Batch import for scheduling headcounts; no seed data or changes to existing RPCs.
-- The bounded transaction serializes headcount writes, including the existing
-- single-row RPCs, so preview checks also protect previously absent records.
CREATE OR REPLACE FUNCTION public.get_scheduling_headcount_import_context(p_college_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.can_manage_college(auth.uid(), p_college_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ليس لديك صلاحية إدارة الكلية' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'code', c.code, 'term_id', c.term_id, 'term_code', t.code,
    'term_name', t.name, 'program_code', p.code, 'program_name', p.name,
    'level_number', l.level_number, 'study_system', c.study_system, 'entry_year', c.entry_year,
    'expected_students', c.expected_students, 'cohort_version', md5(to_jsonb(c)::text),
    'expected_version', CASE WHEN h.id IS NULL THEN NULL ELSE md5(to_jsonb(h)::text) END,
    'headcount', CASE WHEN h.id IS NULL THEN NULL ELSE to_jsonb(h) END
  ) ORDER BY p.code, l.level_number, c.study_system, c.code), '[]'::jsonb) INTO v_rows
  FROM public.academic_cohorts c
  JOIN public.academic_terms t ON t.id = c.term_id AND t.college_id = c.college_id AND t.is_active
  JOIN public.academic_programs p ON p.id = c.program_id AND p.college_id = c.college_id
  JOIN public.academic_levels l ON l.id = c.level_id AND l.program_id = c.program_id
  LEFT JOIN public.scheduling_cohort_term_headcounts h ON h.cohort_id = c.id AND h.term_id = c.term_id
  WHERE c.college_id = p_college_id AND c.active;
  RETURN jsonb_build_object('ok', true, 'cohorts', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.import_scheduling_headcounts(
  p_college_id uuid, p_rows jsonb, p_action text DEFAULT 'save'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET lock_timeout = '3s' AS $$
DECLARE
  v_input jsonb; v_result jsonb; v_out jsonb := '[]'::jsonb; v_field text;
  v_cohort public.academic_cohorts%ROWTYPE;
  v_head public.scheduling_cohort_term_headcounts%ROWTYPE;
  v_existing boolean; v_same boolean; v_changed integer := 0;
  v_fields text[] := ARRAY['registered_student_count','eligible_student_count','expected_attendance_count',
    'reserve_margin','scheduling_headcount','exam_eligible_count'];
BEGIN
  IF auth.uid() IS NULL OR public.can_manage_college(auth.uid(), p_college_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ليس لديك صلاحية إدارة الكلية' USING ERRCODE = '42501';
  END IF;
  IF p_action IS NULL OR p_action NOT IN ('save','approve') OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'طلب غير صالح؛ يلزم من 1 إلى 500 صف' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) r GROUP BY r->>'cohort_id', r->>'term_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'تكرار الدفعة والفصل في الملف' USING ERRCODE = '22023';
  END IF;
  -- Same lock order for all batches. Existing single-row writes wait briefly;
  -- readers continue normally. No lock remains after the RPC transaction ends.
  LOCK TABLE public.academic_cohorts, public.academic_terms IN SHARE MODE;
  LOCK TABLE public.scheduling_cohort_term_headcounts IN SHARE ROW EXCLUSIVE MODE;
  FOR v_input IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_input) IS DISTINCT FROM 'object' OR NOT v_input ?&
      (v_fields || ARRAY['cohort_id','term_id','cohort_version','expected_version','source','notes','allow_over_eligible']) THEN
      RAISE EXCEPTION 'صف ناقص؛ أعد فحص الملف' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_cohort FROM public.academic_cohorts
      WHERE id = (v_input->>'cohort_id')::uuid AND college_id = p_college_id AND active;
    IF NOT FOUND OR v_cohort.term_id IS DISTINCT FROM (v_input->>'term_id')::uuid
      OR md5(to_jsonb(v_cohort)::text) IS DISTINCT FROM v_input->>'cohort_version'
      OR NOT EXISTS (SELECT 1 FROM public.academic_terms WHERE id = v_cohort.term_id AND college_id = p_college_id AND is_active) THEN
      RAISE EXCEPTION 'الدفعة أو الفصل غير مطابقين أو تغيرا بعد المعاينة؛ أعد فحص الملف' USING ERRCODE = '22023';
    END IF;
    FOREACH v_field IN ARRAY v_fields LOOP
      IF jsonb_typeof(v_input->v_field) IS DISTINCT FROM 'number' OR (v_input->>v_field) !~ '^[0-9]+$'
        OR (v_input->>v_field)::numeric > 2147483647 THEN
        RAISE EXCEPTION 'عدد غير صالح في %', v_field USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF (v_input->>'scheduling_headcount')::integer = 0
      OR jsonb_typeof(v_input->'source') IS DISTINCT FROM 'string'
      OR coalesce(length(btrim(v_input->>'source')),0) NOT BETWEEN 1 AND 500
      OR jsonb_typeof(v_input->'notes') NOT IN ('string','null')
      OR coalesce(length(v_input->>'notes'),0) > 2000
      OR jsonb_typeof(v_input->'allow_over_eligible') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'يلزم عدد جدولة موجب ومصدر وملاحظات صالحة' USING ERRCODE = '22023';
    END IF;
    IF ((v_input->>'scheduling_headcount')::integer > (v_input->>'eligible_student_count')::integer
      OR (v_input->>'expected_attendance_count')::integer > (v_input->>'eligible_student_count')::integer)
      AND (NOT (v_input->>'allow_over_eligible')::boolean OR nullif(btrim(v_input->>'notes'),'') IS NULL) THEN
      RAISE EXCEPTION 'تجاوز المؤهلين يتطلب استثناءً صريحًا وسببًا' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_head FROM public.scheduling_cohort_term_headcounts
      WHERE cohort_id = v_cohort.id AND term_id = v_cohort.term_id;
    v_existing := FOUND;
    IF (CASE WHEN v_existing THEN md5(to_jsonb(v_head)::text) ELSE NULL END)
      IS DISTINCT FROM v_input->>'expected_version' THEN
      RAISE EXCEPTION 'تغيرت أعداد الدفعة % بعد المعاينة؛ أعد فحص الملف', v_cohort.code USING ERRCODE = '40001';
    END IF;
    v_same := v_existing AND v_head.source = v_input->>'source'
      AND v_head.notes IS NOT DISTINCT FROM v_input->>'notes' AND v_head.study_system = v_cohort.study_system;
    FOREACH v_field IN ARRAY v_fields LOOP
      v_same := v_same AND (to_jsonb(v_head)->v_field) = (v_input->v_field);
    END LOOP;
    IF p_action = 'save' THEN
      IF NOT coalesce(v_same,false) OR v_head.approval_status = 'archived' THEN
        v_result := public.upsert_scheduling_cohort_term_headcount(
          v_cohort.id, v_cohort.term_id, (v_input->>'registered_student_count')::integer,
          (v_input->>'eligible_student_count')::integer, (v_input->>'expected_attendance_count')::integer,
          (v_input->>'reserve_margin')::integer, (v_input->>'scheduling_headcount')::integer,
          (v_input->>'exam_eligible_count')::integer, v_input->>'source', v_input->>'notes',
          (v_input->>'allow_over_eligible')::boolean);
        IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '%', v_result->>'message'; END IF;
        v_changed := v_changed + 1;
      END IF;
    ELSE
      IF NOT coalesce(v_same,false) OR v_head.approval_status NOT IN ('draft','approved') THEN
        RAISE EXCEPTION 'احفظ الأعداد كمسودة وراجعها قبل الاعتماد' USING ERRCODE = '22023';
      END IF;
      IF v_head.approval_status = 'draft' THEN
        v_result := public.approve_scheduling_cohort_term_headcount(v_head.id, v_head.notes);
        IF v_result->>'ok' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION '%', v_result->>'message'; END IF;
        v_changed := v_changed + 1;
      END IF;
    END IF;
    SELECT * INTO v_head FROM public.scheduling_cohort_term_headcounts WHERE cohort_id = v_cohort.id AND term_id = v_cohort.term_id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('cohort_id', v_cohort.id,
      'term_id', v_cohort.term_id, 'expected_version', md5(to_jsonb(v_head)::text), 'approval_status', v_head.approval_status));
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'rows', v_out, 'changed', v_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.get_scheduling_headcount_import_context(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.import_scheduling_headcounts(uuid,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_scheduling_headcount_import_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_scheduling_headcounts(uuid,jsonb,text) TO authenticated;
NOTIFY pgrst, 'reload schema';
