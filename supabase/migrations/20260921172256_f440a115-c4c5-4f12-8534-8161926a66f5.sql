DO $mig$
DECLARE
  v_college uuid := '8e4bcbb4-4a4c-40c7-a3aa-a53f68bae0bb';
  v_version uuid := '7a1c9b2e-5d34-4f18-9a6b-3c2f8e5d0001';
  v_actor uuid := '716f0f62-26ad-4db5-b2cf-7a2e6c4daefa';
  v_elig bigint;
  v_note text := 'نشر بقرار صريح من المشرف العام: «انشر كما هو بلا تعديل». الصفوف المعلّقة تبقى محفوظة وظاهرة بمواعيدها وقاعاتها الخام بلا هويات وهمية. تعارضات الطلاب المسجلة ناتجة عن عدم توفر أعداد الطلاب وتوزيعها بين المجموعتين، ولم يُغيّر أي يوم أو وقت أو قاعة.';
  v_run record;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_actor::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);

  SELECT eligibility_revision INTO v_elig FROM public.schedule_versions
  WHERE id = v_version AND college_id = v_college AND status = 'draft';
  IF v_elig IS NULL THEN
    RAISE EXCEPTION 'SHARIA_VERSION_NOT_DRAFT';
  END IF;

  PERFORM public.persist_schedule_quality_run(
    v_college, v_version, v_elig, 0, 46, 23, 204,
    jsonb_build_object(
      'workload_balance', jsonb_build_object('weight', 10, 'deduction', 190, 'count', 19),
      'gap_penalty', jsonb_build_object('weight', 3, 'deduction', 9, 'count', 3),
      'distribution_balance', jsonb_build_object('weight', 5, 'deduction', 5, 'count', 1),
      'owner_publish_decision', jsonb_build_object('weight', 0, 'deduction', 0, 'count', 1)
    )
  );

  UPDATE public.schedule_versions SET status = 'review'
   WHERE id = v_version AND college_id = v_college AND status = 'draft';
  INSERT INTO public.schedule_version_events(college_id, schedule_version_id, event_type, from_status, to_status, performed_by, notes, metadata)
  VALUES (v_college, v_version, 'submitted_for_review', 'draft', 'review', v_actor, v_note,
          jsonb_build_object('owner_directive', true, 'eligibility_revision', v_elig));

  UPDATE public.schedule_versions SET status = 'approved'
   WHERE id = v_version AND college_id = v_college AND status = 'review';
  INSERT INTO public.schedule_version_events(college_id, schedule_version_id, event_type, from_status, to_status, performed_by, notes, metadata)
  VALUES (v_college, v_version, 'approved', 'review', 'approved', v_actor, v_note,
          jsonb_build_object('owner_directive', true, 'eligibility_revision', v_elig));

  UPDATE public.schedule_versions SET status = 'published'
   WHERE id = v_version AND college_id = v_college AND status = 'approved';
  INSERT INTO public.schedule_version_events(college_id, schedule_version_id, event_type, from_status, to_status, performed_by, notes, metadata)
  VALUES (v_college, v_version, 'published', 'approved', 'published', v_actor, v_note,
          jsonb_build_object('owner_directive', true, 'eligibility_revision', v_elig,
                             'pending_source_rows_kept', true));

  SELECT status INTO v_run FROM public.schedule_versions WHERE id = v_version;
  IF v_run.status <> 'published' THEN
    RAISE EXCEPTION 'SHARIA_PUBLISH_FAILED:%', v_run.status;
  END IF;
END
$mig$;