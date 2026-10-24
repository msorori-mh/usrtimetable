-- Repair the missing partner partition snapshot of Last and Final only.
-- Copy existing active mappings (33 + 32 regular, 25 parallel); no new students,
-- partitions, session placements, exceptions or published facts are created.
BEGIN;
DO $repair$
DECLARE
  v_version uuid := '0f11c15c-f7ce-4dd3-8974-e856f039d3e7';
  v_college uuid := '7168345f-cf9d-4789-b2ad-547abb687dc8';
  v_groups uuid[] := ARRAY['a2586822-0c14-4613-807b-0b4149f64dd9',
    '5edf7f64-ed6c-49fe-852b-e3d7fce498ba']::uuid[];
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(v_version::text, 9174));
  PERFORM 1 FROM public.schedule_versions
  WHERE id=v_version AND college_id=v_college AND status='draft'
    AND eligibility_revision=315 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_DRAFT_CHANGED'; END IF;
  IF public.schedule_version_session_snapshot(v_version) <> '9188e77fbf4d28389d006275c1cca79b'
    THEN RAISE EXCEPTION 'REPAIR_SESSIONS_CHANGED'; END IF;
  IF EXISTS (SELECT 1 FROM schedule_version_delivery_private.partner_partition_facts
    WHERE version_id=v_version AND group_id=ANY(v_groups))
    THEN RAISE EXCEPTION 'REPAIR_SNAPSHOT_ALREADY_PRESENT'; END IF;
  SELECT count(*) INTO v_count FROM schedule_version_delivery_private.partner_group_facts f
  JOIN public.delivery_groups g ON g.id=f.group_id AND g.college_id=f.college_id
  JOIN public.academic_cohorts c ON c.id=g.cohort_id
  WHERE f.version_id=v_version AND f.group_id=ANY(v_groups) AND f.college_id=v_college
    AND f.expected_students=c.expected_students AND c.count_status='confirmed'
    AND NOT EXISTS (SELECT 1 FROM schedule_version_delivery_private.scope s
      WHERE s.version_id=v_version AND s.cohort_id=g.cohort_id)
    AND f.expected_students=(SELECT sum(p.headcount)
      FROM public.delivery_group_partition_members m
      JOIN public.cohort_student_partitions p ON p.id=m.partition_id
      WHERE m.delivery_group_id=g.id AND p.active
        AND m.cohort_id=g.cohort_id AND p.cohort_id=g.cohort_id
        AND m.college_id=v_college AND p.college_id=v_college);
  IF v_count<>2 THEN RAISE EXCEPTION 'REPAIR_SOURCE_COVERAGE_CHANGED'; END IF;

  INSERT INTO schedule_version_delivery_private.partner_partition_facts
    (version_id,group_id,cohort_id,partition_id,headcount)
  SELECT v_version,m.delivery_group_id,m.cohort_id,m.partition_id,p.headcount
  FROM public.delivery_group_partition_members m
  JOIN public.cohort_student_partitions p ON p.id=m.partition_id AND p.active
  WHERE m.delivery_group_id=ANY(v_groups) AND m.college_id=v_college
    AND p.college_id=v_college AND p.cohort_id=m.cohort_id;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>3 THEN RAISE EXCEPTION 'REPAIR_UNEXPECTED_PARTITION_COUNT'; END IF;
  UPDATE public.schedule_versions SET eligibility_revision=eligibility_revision+1
    WHERE id=v_version;
  INSERT INTO public.audit_logs(college_id,entity,entity_id,action,details)
  VALUES(v_college,'schedule_versions',v_version,'restore_missing_partner_partitions',
    jsonb_build_object('rows',v_count,'executor','database maintenance via Supabase connector',
      'source','delivery_group_partition_members','regular_students',65,'parallel_students',25,
      'note','استعادة روابط الطلاب الأصلية المطابقة لأعداد المسودة؛ دون تعديل المحاضرات.'));
  IF public.schedule_version_session_snapshot(v_version) <> '9188e77fbf4d28389d006275c1cca79b'
    THEN RAISE EXCEPTION 'REPAIR_CHANGED_SESSIONS'; END IF;
END $repair$;
COMMIT;
